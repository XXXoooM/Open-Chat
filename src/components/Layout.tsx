import { Outlet } from "react-router-dom";

/**
 * 全局布局容器。
 *
 * 修复 AUDIT.md ENG-04：此前这里用 MutationObserver + <style> 强制隐藏平台的
 * watermark / branding / powered-by 元素，并在每次 DOM 变更时对整个 body 子树
 * 做全量选择器查询（聊天消息频繁上屏时持续触发）。该做法既绕过平台展示约束，
 * 又有明确的性能开销，且 [class*="badge"] 之类宽泛选择器存在误伤业务元素的
 * 风险，现已整体移除。
 */
export const Layout = () => {
  return <Outlet />;
};
