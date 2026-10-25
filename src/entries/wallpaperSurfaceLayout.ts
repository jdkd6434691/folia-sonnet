// src/entries/wallpaperSurfaceLayout.ts
// Pins the page to the size the native side passed in the URL and forces the shell chain to fill
// it: without explicit pixels the canvas falls back to its internal minimum and shows one strip.

/**
 * 把根节点钉死在原生给的尺寸上。
 *
 * 不能用 100vw/100vh：WebView 的布局视口和窗口实际大小不一定一致，
 * 可视化在挂载那一刻读到多宽，画布就定死多宽 —— 结果就是画面只占屏幕一部分，
 * 而且横竖屏都不对。尺寸从原生传进来（CSS 像素），是唯一确定的来源。
 */
const pinToNativeSize = (element: HTMLElement) => {
    const params = new URLSearchParams(window.location.search);
    const width = Number(params.get('w'));
    const height = Number(params.get('h'));
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return false;
    }
    document.documentElement.style.width = `${width}px`;
    document.documentElement.style.height = `${height}px`;
    document.body.style.width = `${width}px`;
    document.body.style.height = `${height}px`;
    element.style.position = 'fixed';
    element.style.left = '0';
    element.style.top = '0';
    element.style.width = `${width}px`;
    element.style.height = `${height}px`;
    return true;
};

/**
 * 原生经 URL 传进来的舞台尺寸（CSS 像素），直接当 px 用。
 * 拿不到时退回 100%，但正常路径上一定有。
 */

const stageSize = (() => {
    const params = new URLSearchParams(window.location.search);
    const width = Number(params.get('w'));
    const height = Number(params.get('h'));
    return {
        width: Number.isFinite(width) && width > 0 ? `${width}px` : '100%',
        height: Number.isFinite(height) && height > 0 ? `${height}px` : '100%',
    };
})();

/**
 * 把「画布 → 舞台」这条祖先链逐级强制撑满。
 *
 * 为什么不能只靠给舞台写死像素：可视化的外壳是 `w-full h-full`（百分比高度），
 * 中间只要有一环是 auto，高度就塌 —— 实测外壳只有 268、宿主 0，
 * 结果画布落到 Pixi runtime 里的兜底下限（240），只画出顶上一条。
 * 而中间那几层是各个可视化模式自己的 DOM，不可能逐个去改。
 *
 * 所以从画布往上走，只给它**这一条**祖先链写 height:100%：
 * 不碰歌词、装饰等旁支元素，风险最小。
 */
/**
 * 把「舞台 → 外壳」这一段撑满。
 *
 * 教训：**不能用一条覆盖前三层的全局 CSS 规则**（`height:100% !important`）——
 * 试过，结果把各模式自己的布局一起改了：齿轮被拉伸、歌词消失、有的模式整个不渲染。
 * 那些层里有各模式有意指定的尺寸（定比舞台、装饰物），一刀切必然误伤。
 *
 * 也不能只照着 canvas 找祖先：纯 CSS 布局的模式根本没有 canvas，
 * 链上照样有 auto 层，内容就偏出屏幕中心。
 *
 * 所以这里只做一件事：从**外壳**往上把祖先链撑满，并让外壳自身 100%。
 * 外壳之上是纯容器，改它们没有任何副作用；外壳之内一律不碰。
 */
const forceShellToFill = () => {
    const stage = document.getElementById('wallpaper-stage');
    if (!stage) return;
    // 外壳：VisualizerShell 的根（w-full h-full flex flex-col …）。
    const shell = stage.querySelector('.w-full.h-full.flex') as HTMLElement | null;
    if (!shell) return;

    if (shell.style.height !== '100%') {
        shell.style.height = '100%';
        shell.style.minHeight = '100%';
    }
    // 外壳与舞台之间的中间层（懒加载包装之类）也一并撑起来。
    let element = shell.parentElement;
    while (element && element !== stage) {
        // 只在真的不一样时才写：反复写同一个值会不停触发 ResizeObserver，
        // 而某些模式（莫奈那类带滤镜的）在 resize 后会重算滤镜目标，
        // 反复重算就会出现发光异常。
        if (element.style.height !== '100%') {
            element.style.height = '100%';
            element.style.minHeight = '100%';
        }
        element = element.parentElement;
    }
};

/**
 * 画布这条链单独再撑一次。
 *
 * 前面那个是按外壳找的，正常情况够用；但有的模式把 canvas 挂在
 * 外壳之外的容器里（背景层），那条链跟外壳链不是同一条。
 */
const forceCanvasChainToFill = () => {
    const stage = document.getElementById('wallpaper-stage');
    if (!stage) return;
    const canvas = stage.querySelector('canvas');
    if (!canvas) return;
    let element: HTMLElement | null = canvas.parentElement;
    while (element && element !== stage) {
        /*
         * 只修**确实塌了**的那一环（高度为 0）。
         *
         * 之前这里是"进了外壳就不再往上改"，结果把最需要修的链挡住了：
         * 外壳已经是 1067，但外壳内部还有一层塌掉的容器，画布照样被卡在兜底下限 240。
         *
         * 反过来也不能无脑全改 —— 某些模式有意把容器设成特定尺寸（定比舞台、装饰层）。
         * 高度恰好为 0 只可能是链断了，不可能是哪种设计（那样什么也看不见），
         * 所以拿这个当判据，既不误伤又能修好塌陷。
         */
        if (element.clientHeight === 0) {
            element.style.height = '100%';
            element.style.minHeight = '100%';
        }
        element = element.parentElement;
    }
};

/** 等两帧：WebView 刚创建时尺寸可能还是 0，布局稳定后才是真的。 */
const afterLayout = () => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
});

export { afterLayout, forceCanvasChainToFill, forceShellToFill, pinToNativeSize, stageSize };

