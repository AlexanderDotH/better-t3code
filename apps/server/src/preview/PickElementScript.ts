// Page-side source keeps DOM types out of the server build.
export const PICK_ELEMENT_SCRIPT = `({ x, y }) => {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const selectorFor = (element) => {
    const root = element.getRootNode();
    const parts = [];
    for (let node = element; node; node = node.parentElement) {
      if (node.id) {
        const id = '#' + CSS.escape(node.id);
        if (root.querySelectorAll(id).length === 1) { parts.unshift(id); break; }
      }
      let part = node.localName;
      const siblings = node.parentElement && [...node.parentElement.children].filter(child => child.localName === node.localName);
      if (siblings && siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
      parts.unshift(part);
      if (root.querySelectorAll(parts.join(' > ')).length === 1) break;
    }
    const selector = parts.join(' > ');
    return root.host ? selectorFor(root.host) + ' ' + selector : selector;
  };
  let doc = document;
  let localX = x, localY = y, offsetX = 0, offsetY = 0, scaleX = 1, scaleY = 1;
  let element = null;
  const frames = [];
  for (let depth = 0; depth < 32; depth++) {
    element = doc.elementFromPoint(localX, localY);
    if (!element) return null;
    while (element.shadowRoot) {
      const inner = element.shadowRoot.elementFromPoint(localX, localY);
      if (!inner || inner === element) break;
      element = inner;
    }
    if (element.localName !== 'iframe' && element.localName !== 'frame') break;
    let child;
    try { child = element.contentDocument; } catch { break; }
    if (!child) break;
    const box = element.getBoundingClientRect();
    const sx = box.width / element.offsetWidth;
    const sy = box.height / element.offsetHeight;
    if (!(sx > 0 && sy > 0)) break;
    const originX = box.left + element.clientLeft * sx;
    const originY = box.top + element.clientTop * sy;
    const nextX = (localX - originX) / sx;
    const nextY = (localY - originY) / sy;
    if (nextX < 0 || nextY < 0 || nextX >= element.clientWidth || nextY >= element.clientHeight) break;
    frames.push(selectorFor(element));
    offsetX += originX * scaleX;
    offsetY += originY * scaleY;
    scaleX *= sx;
    scaleY *= sy;
    localX = nextX; localY = nextY; doc = child;
  }
  if (!element || element === doc.body || element === doc.documentElement) return null;
  const box = element.getBoundingClientRect();
  const rect = { x: offsetX + box.left * scaleX, y: offsetY + box.top * scaleY, width: box.width * scaleX, height: box.height * scaleY };
  const stack = [];
  let componentName = null;
  let fiber = null;
  for (let node = element; node && !fiber; node = node.parentElement || node.getRootNode().host) {
    const key = Object.keys(node).find(key => key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$'));
    if (key) fiber = node[key];
  }
  const seen = new Set();
  while (fiber && !seen.has(fiber) && seen.size < 50) {
    seen.add(fiber);
    const type = fiber.type;
    const name = typeof type === 'string' ? null : type?.displayName || type?.name || type?.render?.displayName || type?.render?.name || null;
    if (!componentName && name) componentName = name;
    const source = fiber._debugSource;
    if (source) stack.push({ functionName: name, fileName: source.fileName ?? null, lineNumber: source.lineNumber ?? null, columnNumber: source.columnNumber ?? null });
    else if (fiber._debugStack?.stack) {
      const frames = String(fiber._debugStack.stack).slice(0, 8000).split('\\n').flatMap(line => {
        const match = /^\\s*at\\s+(?:([^()]+?)\\s+\\()?(.+?):(\\d+):(\\d+)\\)?$/.exec(line);
        if (!match || /node_modules\\/(?:react|react-dom|scheduler)\\//.test(match[2])) return [];
        return [{ functionName: match[1]?.trim() || name, fileName: match[2], lineNumber: Number(match[3]), columnNumber: Number(match[4]) }];
      });
      const frame = frames.find(frame => frame.functionName === name) || frames[0];
      if (frame) stack.push(frame);
    }
    fiber = fiber._debugOwner || fiber.return;
  }
  const computed = doc.defaultView.getComputedStyle(element);
  const properties = ['display', 'position', 'width', 'height', 'color', 'background-color', 'font-family', 'font-size', 'font-weight', 'line-height', 'margin', 'padding', 'border', 'border-radius', 'box-shadow', 'opacity', 'overflow', 'align-items', 'justify-content', 'gap', 'flex', 'grid-template-columns'];
  const styles = properties.map(property => property + ': ' + computed.getPropertyValue(property) + ';').join('\\n').slice(0, 4000);
  return {
    capture: { pageUrl: location.href, pageTitle: document.title, tagName: element.tagName, outerHTML: element.outerHTML.slice(0, 4000), pickedAt: new Date().toISOString() },
    context: { selector: [...frames, selectorFor(element)].join(' >> internal:control=enter-frame >> '), htmlPreview: element.outerHTML.slice(0, 4000), componentName, stack, styles },
    rect,
  };
}`;
