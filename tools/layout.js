function nodes(node) {
  return [node, ...(node?.children ?? []).flatMap(nodes)];
}

export function addBrowser(layout) {
  const next = structuredClone(layout);
  const all = nodes(next);
  const tabs = all.filter((node) => node.type === "block" && ["tabs", "tabs-browser"].includes(node.content?.mod));
  if (!tabs.length) throw new Error("the layout has no tabs block");
  const body = all.find((node) => node.id === "panel-body");
  if (body?.type !== "stack") throw new Error("the layout has no panel-body stack");
  const browser = body.children?.find((child) => child.id === "browser");
  if (all.filter((node) => node.id === "browser").length > (browser ? 1 : 0)) throw new Error(browser ? "the layout uses the id browser more than once" : "the layout uses the id browser outside panel-body");
  if (browser && (browser.type !== "block" || browser.content?.mod !== "browser")) throw new Error("panel-body has a browser child that is not the browser mod's block");
  for (const node of tabs) node.content.mod = "tabs-browser";
  if (!browser) (body.children ??= []).push({ id: "browser", type: "block", content: { mod: "browser" } });
  return next;
}
