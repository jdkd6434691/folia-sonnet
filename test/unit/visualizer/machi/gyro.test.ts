import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    MACHI_GYRO_FLAT,
    MACHI_GYRO_RANGE,
    machiGyroSupported,
    machiScreenAngle,
    machiScreenOffsets,
    machiTiltDegrees,
    nextMachiFlat,
    requestMachiGyroPermission,
    subscribeMachiGyro,
} from '@/components/visualizer/machi/gyro';

// test/unit/visualizer/machi/gyro.test.ts
// 町景陀螺仪读数：相对按下开关那一刻的偏移、夹在范围内、没有 DeviceOrientationEvent 时静静地什么都不做；
// 手机平放到桌面上时把偏移交回零（镜头回正），搁着不动不跟着桌面上的抖动抽搐，拿起来又从新姿态起算。

/** 造一个假 window，装上 DeviceOrientationEvent 与事件收发。 */
const fakeWindow = (permission?: () => Promise<string>) => {
    const listeners = new Map<string, ((event: unknown) => void)[]>();
    const target = {
        DeviceOrientationEvent: Object.assign(class {}, permission ? { requestPermission: permission } : {}),
        addEventListener: (type: string, listener: (event: unknown) => void) => {
            listeners.set(type, [...(listeners.get(type) ?? []), listener]);
        },
        removeEventListener: (type: string, listener: (event: unknown) => void) => {
            listeners.set(type, (listeners.get(type) ?? []).filter(entry => entry !== listener));
        },
        dispatch: (type: string, event: unknown) => {
            for (const listener of listeners.get(type) ?? []) listener(event);
        },
        listenerCount: (type: string) => (listeners.get(type) ?? []).length,
    };
    vi.stubGlobal('window', target);
    return target;
};

// 偏移按度数给，断言的容差按“到范围内的百分比”看。
const DEGREE = Math.PI / 180;

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('machi gyro', () => {
    it('is off when the platform has no DeviceOrientationEvent', () => {
        vi.stubGlobal('window', {});
        expect(machiGyroSupported()).toBe(false);
        // 没有读数就退订函数是空的，权限也算“不给”。
        expect(typeof subscribeMachiGyro(() => {})).toBe('function');
        return expect(requestMachiGyroPermission()).resolves.toBe(false);
    });

    it('measures the tilt relative to the reading it started on', () => {
        const target = fakeWindow();
        const seen: { azimuth: number; elevation: number }[] = [];
        const stop = subscribeMachiGyro(offsets => seen.push(offsets));
        // 第一条读数只当基准，不报偏移。
        target.dispatch('deviceorientation', { beta: 40, gamma: -10 });
        expect(seen).toEqual([]);
        target.dispatch('deviceorientation', { beta: 46, gamma: -4 });
        expect(seen).toHaveLength(1);
        expect(seen[0]!.azimuth).toBeCloseTo(6 * DEGREE, 6);
        expect(seen[0]!.elevation).toBeCloseTo(6 * DEGREE, 6);
        stop();
        expect(target.listenerCount('deviceorientation')).toBe(0);
    });

    it('clamps a big tilt to the range so the shot never swings away', () => {
        const target = fakeWindow();
        const seen: { azimuth: number; elevation: number }[] = [];
        subscribeMachiGyro(offsets => seen.push(offsets));
        target.dispatch('deviceorientation', { beta: 0, gamma: 0 });
        // 分两步转，每步都在可信幅度里（一步跳太多会被当成换系，重新取基准）。
        target.dispatch('deviceorientation', { beta: 50, gamma: -50 });
        target.dispatch('deviceorientation', { beta: 89, gamma: -89 });
        expect(seen[0]!.azimuth).toBeCloseTo(-MACHI_GYRO_RANGE.azimuth, 6);
        expect(seen[0]!.elevation).toBeCloseTo(MACHI_GYRO_RANGE.elevation, 6);
    });

    it('skips readings the device sends without motion data', () => {
        const target = fakeWindow();
        const seen: { azimuth: number }[] = [];
        subscribeMachiGyro(offsets => seen.push(offsets));
        target.dispatch('deviceorientation', { beta: null, gamma: null });
        target.dispatch('deviceorientation', { beta: 10, gamma: 5 });
        // 上面那条 null 读数不能当基准，所以这一条才是基准，仍然不报。
        expect(seen).toEqual([]);
        target.dispatch('deviceorientation', { beta: 12, gamma: 7 });
        expect(seen).toHaveLength(1);
    });

    it('takes a new reference after the screen turns', () => {
        const target = fakeWindow();
        const seen: { azimuth: number }[] = [];
        subscribeMachiGyro(offsets => seen.push(offsets));
        // 举着看（否则下面这些角度只是「放在桌上」，那是另一条路，见平放的用例）。
        target.dispatch('deviceorientation', { beta: 60, gamma: 0 });
        target.dispatch('deviceorientation', { beta: 60, gamma: 5 });
        expect(seen).toHaveLength(1);
        target.dispatch('orientationchange', {});
        // 转屏后第一条读数重新当基准，画面不会跳。
        target.dispatch('deviceorientation', { beta: 60, gamma: -20 });
        expect(seen).toHaveLength(1);
        target.dispatch('deviceorientation', { beta: 60, gamma: -22 });
        expect(seen[1]!.azimuth).toBeCloseTo(-2 * DEGREE, 6);
    });

    it('comes back after sitting at the limit instead of sticking there', () => {
        const target = fakeWindow();
        const seen: { azimuth: number; elevation: number }[] = [];
        subscribeMachiGyro(offsets => seen.push(offsets));
        target.dispatch('deviceorientation', { beta: 60, gamma: 0 });
        // 转到远超范围：夹在上限。
        target.dispatch('deviceorientation', { beta: 60, gamma: 40 });
        expect(seen[0]!.azimuth).toBeCloseTo(MACHI_GYRO_RANGE.azimuth, 6);
        // 停在极限上转回来：必须跟着回，不能卡住。
        target.dispatch('deviceorientation', { beta: 60, gamma: 2 });
        expect(seen[1]!.azimuth).toBeCloseTo(2 * DEGREE, 6);
    });

    it('takes the pose as a new reference when the reading jumps (phone past vertical)', () => {
        const target = fakeWindow();
        const seen: { azimuth: number; elevation: number }[] = [];
        subscribeMachiGyro(offsets => seen.push(offsets));
        target.dispatch('deviceorientation', { beta: 88, gamma: 0 });
        target.dispatch('deviceorientation', { beta: 100, gamma: 0 });
        expect(seen[0]!.elevation).toBeCloseTo(MACHI_GYRO_RANGE.elevation, 6);
        // 翻过竖直方向，读数换系跳一大截：不能当成「倾斜到极限」，而是以新姿态为基准、偏移归零。
        target.dispatch('deviceorientation', { beta: -85, gamma: 0 });
        expect(seen[1]).toEqual({ azimuth: 0, elevation: 0 });
        // 从新基准继续转，仍然跟得上。
        target.dispatch('deviceorientation', { beta: -88, gamma: 0 });
        expect(seen[2]!.elevation).toBeCloseTo(-3 * DEGREE, 6);
    });

    it('asks iOS for permission and reports what the user said', async () => {
        fakeWindow(async () => 'granted');
        await expect(requestMachiGyroPermission()).resolves.toBe(true);
        fakeWindow(async () => 'denied');
        await expect(requestMachiGyroPermission()).resolves.toBe(false);
        fakeWindow(async () => {
            throw new Error('no gesture');
        });
        await expect(requestMachiGyroPermission()).resolves.toBe(false);
    });

    it('treats platforms without requestPermission as already allowed', async () => {
        fakeWindow();
        await expect(requestMachiGyroPermission()).resolves.toBe(true);
    });

    it('maps device axes onto screen axes for every screen angle', () => {
        // 竖屏：gamma 管左右、beta 管上下。
        expect(machiScreenOffsets(0, 10, 0)).toEqual({ azimuth: 10 * DEGREE, elevation: 0 });
        expect(machiScreenOffsets(10, 0, 0)).toEqual({ azimuth: 0, elevation: 10 * DEGREE });
        // 横屏 90°：两轴互换（左右变成上下、上下变成左右）。
        expect(machiScreenOffsets(10, 0, 90)).toEqual({ azimuth: -10 * DEGREE, elevation: 0 });
        expect(machiScreenOffsets(0, 10, 90)).toEqual({ azimuth: 0, elevation: 10 * DEGREE });
        // 反方向横过来：符号相反。
        expect(machiScreenOffsets(10, 0, 270)).toEqual({ azimuth: 10 * DEGREE, elevation: 0 });
        expect(machiScreenOffsets(0, 10, 270)).toEqual({ azimuth: 0, elevation: -10 * DEGREE });
        // 倒置：两轴都反。
        expect(machiScreenOffsets(10, 10, 180)).toEqual({ azimuth: -10 * DEGREE, elevation: -10 * DEGREE });
    });

    it('reads the screen angle, falling back to window.orientation and portrait', () => {
        const target = fakeWindow();
        expect(machiScreenAngle()).toBe(0);
        (target as unknown as { screen: unknown }).screen = { orientation: { angle: 90 } };
        expect(machiScreenAngle()).toBe(90);
        (target as unknown as { screen: unknown }).screen = { orientation: { angle: 275 } };
        expect(machiScreenAngle()).toBe(270);
        (target as unknown as { screen: unknown }).screen = undefined;
        (target as unknown as { orientation: number }).orientation = -90;
        expect(machiScreenAngle()).toBe(270);
    });

    it('turns a landscape tilt into the same on-screen direction', () => {
        const target = fakeWindow();
        (target as unknown as { screen: unknown }).screen = { orientation: { angle: 90 } };
        const seen: { azimuth: number; elevation: number }[] = [];
        subscribeMachiGyro(offsets => seen.push(offsets));
        target.dispatch('deviceorientation', { beta: 60, gamma: 0 });
        // 横屏下左右倾（设备坐标是 beta）：屏幕上是左右转。
        target.dispatch('deviceorientation', { beta: 65, gamma: 0 });
        expect(seen[0]!.azimuth).toBeCloseTo(-5 * DEGREE, 6);
        expect(seen[0]!.elevation).toBeCloseTo(0, 6);
        // 横屏下上下倾（设备坐标是 gamma）：屏幕上是俯仰。
        target.dispatch('deviceorientation', { beta: 65, gamma: 4 });
        expect(seen[1]!.azimuth).toBeCloseTo(-5 * DEGREE, 6);
        expect(seen[1]!.elevation).toBeCloseTo(4 * DEGREE, 6);
    });

    it('reads the tilt of the screen off the vertical, whichever way it is turned', () => {
        // 0° 正面朝上平放、180° 正面朝下平放、90° 举着看。
        expect(machiTiltDegrees(0, 0)).toBeCloseTo(0, 6);
        expect(machiTiltDegrees(180, 0)).toBeCloseTo(180, 6);
        expect(machiTiltDegrees(90, 0)).toBeCloseTo(90, 6);
        expect(machiTiltDegrees(0, 90)).toBeCloseTo(90, 6);
        expect(machiTiltDegrees(45, 0)).toBeCloseTo(45, 6);
        // beta / gamma 说的是设备自己的姿态，与屏幕横竖无关。
        for (const [beta, gamma] of [[0, 0], [90, 0], [30, 20], [-60, 35]]) {
            const angle = machiTiltDegrees(beta, gamma);
            expect(angle).toBeGreaterThanOrEqual(0);
            expect(angle).toBeLessThanOrEqual(180);
        }
    });

    it('keeps a band of hysteresis between being set down and being picked up', () => {
        const between = (MACHI_GYRO_FLAT.enterDeg + MACHI_GYRO_FLAT.leaveDeg) / 2;
        expect(nextMachiFlat(false, MACHI_GYRO_FLAT.enterDeg - 1)).toBe(true);
        expect(nextMachiFlat(false, MACHI_GYRO_FLAT.enterDeg + 1)).toBe(false);
        expect(nextMachiFlat(true, MACHI_GYRO_FLAT.leaveDeg - 1)).toBe(true);
        expect(nextMachiFlat(true, MACHI_GYRO_FLAT.leaveDeg + 1)).toBe(false);
        // 两个阈值之间状态不动，手机停在边界上时不会来回翻。
        expect(nextMachiFlat(false, between)).toBe(false);
        expect(nextMachiFlat(true, between)).toBe(true);
    });

    it('hands the shot back to rest when the phone is set down, and stays put while it lies there', () => {
        const target = fakeWindow();
        const seen: { azimuth: number; elevation: number }[] = [];
        subscribeMachiGyro(offsets => seen.push(offsets));
        // 举着看：基准。
        target.dispatch('deviceorientation', { beta: 80, gamma: 0 });
        target.dispatch('deviceorientation', { beta: 80, gamma: 6 });
        expect(seen.at(-1)!.azimuth).toBeCloseTo(6 * DEGREE, 6);
        // 放到桌面上：偏移交回零，镜头才回得去（以前这里会被夹成 −6° 的俯视，一直低着头）。
        target.dispatch('deviceorientation', { beta: 4, gamma: 2 });
        expect(seen.at(-1)).toEqual({ azimuth: 0, elevation: 0 });
        // 桌面上的读数本来就乱跳，搁着不动就不再跟着抽搐。
        for (const [beta, gamma] of [[6, -14], [1, 11], [3, -9]]) {
            target.dispatch('deviceorientation', { beta, gamma });
            expect(seen.at(-1)).toEqual({ azimuth: 0, elevation: 0 });
        }
        // 拿起来：以这一刻为新基准，镜头不跳，随后照常跟着倾斜。
        target.dispatch('deviceorientation', { beta: 82, gamma: 3 });
        expect(seen.at(-1)).toEqual({ azimuth: 0, elevation: 0 });
        target.dispatch('deviceorientation', { beta: 82, gamma: 5 });
        expect(seen.at(-1)!.azimuth).toBeCloseTo(2 * DEGREE, 6);
    });
});
