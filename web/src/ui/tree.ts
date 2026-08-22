import type { TreeNode } from '../api';

export class FileTree {
  #el: HTMLElement;
  #onSelect: (path: string) => void;
  #selected: string | null = null;
  #collapsed = new Set<string>();
  #nodes: TreeNode[] = [];

  constructor(el: HTMLElement, onSelect: (path: string) => void) {
    this.#el = el;
    this.#onSelect = onSelect;
  }

  setNodes(nodes: TreeNode[]) {
    this.#nodes = nodes;
    this.render();
  }

  select(path: string | null) {
    this.#selected = path;
    this.render();
  }

  render() {
    this.#el.replaceChildren(
      this.#nodes.length
        ? this.#list(this.#nodes)
        : Object.assign(document.createElement('p'), {
            className: 'muted empty',
            textContent: 'No .scad files under this root.',
          }),
    );
  }

  #list(nodes: TreeNode[]): HTMLElement {
    const ul = document.createElement('ul');
    for (const node of nodes) ul.append(this.#item(node));
    return ul;
  }

  #item(node: TreeNode): HTMLElement {
    const li = document.createElement('li');
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `row ${node.type}`;

    if (node.type === 'dir') {
      const collapsed = this.#collapsed.has(node.path);
      row.classList.toggle('collapsed', collapsed);
      row.innerHTML = `<span class="caret">${collapsed ? '▸' : '▾'}</span>`;
      row.append(document.createTextNode(node.name));
      row.onclick = () => {
        if (collapsed) this.#collapsed.delete(node.path);
        else this.#collapsed.add(node.path);
        this.render();
      };
      li.append(row);
      if (!collapsed && node.children?.length) li.append(this.#list(node.children));
    } else {
      row.classList.toggle('selected', node.path === this.#selected);
      row.textContent = node.name;
      row.title = node.path;
      row.onclick = () => this.#onSelect(node.path);
      li.append(row);
    }
    return li;
  }
}
