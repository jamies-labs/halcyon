type Attrs = Record<string, string>;
type Child = Node | string;

function apply(node: Element, attrs: Attrs, children: Child[]): void {
  for (const [key, value] of Object.entries(attrs))
    node.setAttribute(key, value);
  for (const child of children) {
    node.append(
      typeof child === "string" ? document.createTextNode(child) : child,
    );
  }
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  apply(node, attrs, children);
  return node;
}

export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): SVGElementTagNameMap[K] {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  apply(node, attrs, children);
  return node;
}
