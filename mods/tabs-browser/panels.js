export function panelIds(enabled, body) {
  const rest = enabled.filter((id) => id !== "browser");
  return body?.type === "stack" && (body.children ?? []).some((child) => child.id === "browser") ? [...rest, "browser"] : rest;
}
