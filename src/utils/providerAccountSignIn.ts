// src/utils/providerAccountSignIn.ts
// 在线平台的账号登录着没有。歌词来源只在登录后才出现（utils/lyrics/lyricMatchSources.ts），
// 而纯变换层不能 import stores —— 也不该为了一个布尔值把整个账号状态拉进来。
//
// 所以这里只留一个挂载点：账号 store 在自己的模块里注册读取器，逻辑层只调
// isProviderAccountSignedIn。与 utils/visualizerModeLabel 同一形状：低层持有接口，
// 装配方把实现放进来。读取器每次问的是 store 当时的状态，不是注册时的快照。
//
// 没有注册时当作没人登录：需要账号的来源不出现，也不会向它发请求。账号 store 由入口
// 静态引入，正常启动时它总在第一次自动匹配之前注册好。

type ProviderAccountProbe = (providerId: string) => boolean;

let probe: ProviderAccountProbe | null = null;

/** 由 stores/useOnlineProviderAccountStore 在模块初始化时调用；重复注册以最后一次为准（HMR 会重跑注册方）。 */
export const registerProviderAccountProbe = (next: ProviderAccountProbe): void => {
    probe = next;
};

/** 这个在线平台的账号是否登录着。 */
export const isProviderAccountSignedIn = (providerId: string): boolean => probe?.(providerId) ?? false;
