import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { handOverStandIn, type StandInHandover } from '../transitions/standInHandover';
import type { CollectionMorphPlan } from '../transitions/morphGeometry';

// src/library/suites/grid/collection/useGridViewStandIn.ts
// 移形换影的替身卡：入场计划给的那张卡、它交棒给 hero 的时机与退场。原 GridView.tsx 的状态、layout effect
// 与清理 effect 原样搬出；卡片侧的输入（hero 下标、卡片引用、加载态）在 effect 里经 getter 现取——
// 替身要在卡片层之前算出 entranceKind，而交棒要等卡片层渲染完。

export type StandInCard = { coverUrl: string | null; title: string | null; gone?: boolean };

export interface GridViewStandInParams {
    morphPlan: CollectionMorphPlan | null;
    /** 交棒所需的卡片侧输入：每次 commit 现取。 */
    readHandoverInputs: () => {
        showLoading: boolean;
        gridItemCount: number;
        renderedIndexCount: number;
        cardWrapperRefs: RefObject<(HTMLDivElement | null)[]>;
        morphHeroIndex: number;
    };
}

export const useGridViewStandIn = ({ morphPlan, readHandoverInputs }: GridViewStandInParams) => {
    // The stand-in: a card at the hero's place that a cover flying to this page lands on. It is
    // there from the first render (the overlay measures it in the commit that mounts the page),
    // shows the picture that flies, and is the loading card for as long as no track has come.
    // The plan is gone some half a second later; the stand-in is the page's own from then on.
    // `gone`: it has handed over and is off the page, while the hero is still coming to rest.
    const [standIn, setStandIn] = useState<StandInCard | null>(() => (
        morphPlan?.kind === 'morph' ? { coverUrl: morphPlan.coverUrl ?? null, title: morphPlan.title ?? null } : null
    ));
    const standInCardRef = useRef<HTMLDivElement>(null);
    const standInHandoverRef = useRef<StandInHandover | null>(null);
    // What the cards enter by. A page a cover flew to keeps its plan for as long as the stand-in
    // shows: its cards may come seconds after the flight, and still take the hero's place under it.
    // And until the hero has come to rest: the plan's end renders every card again, which is
    // not to fall into the middle of the hero's turn.
    // The plan's kind and not the plan: the page's own plan takes over from the flight's when that
    // is taken back (at landing), and every card would be rendered again for a plan that says the same.
    const entranceKind = morphPlan?.kind ?? (standIn ? 'morph' : null);

    // The stand-in hands over to the hero card (standInHandover.ts). Looked at after every
    // commit: the handover starts in the commit that mounts the hero, which is held out of sight
    // from then on, and is told once the flight to the stand-in is over (the plan is gone). The
    // stand-in goes when the handover says so.
    useLayoutEffect(() => {
        const standInCard = standInCardRef.current;
        if (!standIn || !standInCard) {
            standInHandoverRef.current?.cancel();
            standInHandoverRef.current = null;
            return;
        }
        if (!standInHandoverRef.current) {
            const { showLoading, gridItemCount, renderedIndexCount, cardWrapperRefs, morphHeroIndex } = readHandoverInputs();
            const hero = cardWrapperRefs.current[morphHeroIndex]?.firstElementChild;
            const hasHero = hero instanceof HTMLElement;
            // No hero is to come to a page whose flight is over and that has stopped reading
            // with no cards, or shows cards with the hero not among them. Cards that have been
            // read are mounted a commit later: until then one may come.
            const noHeroToCome = !morphPlan && !showLoading && (gridItemCount === 0 || renderedIndexCount > 0);
            if (hasHero || noHeroToCome) {
                standInHandoverRef.current = handOverStandIn(
                    standInCard,
                    hasHero ? hero : null,
                    () => setStandIn(current => current && { ...current, gone: true }),
                    () => setStandIn(null),
                );
            }
        }
        if (!morphPlan) standInHandoverRef.current?.land();
    });
    useEffect(() => () => {
        standInHandoverRef.current?.cancel();
        standInHandoverRef.current = null;
    }, []);

    return { standIn, standInCardRef, entranceKind };
};
