// Builds the assembly tree shown in the PARTS panel from the flat part list.
// Each part carries `path`: the named assembly nodes above it, outermost first.
//
// Node shapes:
//   group: { type: 'group', id, name, children: [...], partIds: [...all parts below] }
//   part:  { type: 'part', id, name, partIds: [id] }

export function buildAssemblyTree(parts) {
  const root = { type: 'group', id: 'root', name: 'root', children: [], partIds: [] };
  const groups = new Map([['root', root]]);

  for (const part of parts) {
    let parent = root;
    parent.partIds.push(part.id);
    for (const step of part.path ?? []) {
      let group = groups.get(step.id);
      if (!group) {
        group = { type: 'group', id: step.id, name: step.name, children: [], partIds: [] };
        groups.set(step.id, group);
        parent.children.push(group);
      }
      group.partIds.push(part.id);
      parent = group;
    }
    parent.children.push({ type: 'part', id: part.id, name: part.name, partIds: [part.id] });
  }

  // A single top-level group (the assembly itself) adds nothing; show its contents.
  if (root.children.length === 1 && root.children[0].type === 'group') {
    return root.children[0].children;
  }
  return root.children;
}

// Keeps parts whose name matches the query, plus the groups leading to them.
// A group whose own name matches keeps everything inside it.
export function filterAssemblyTree(nodes, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return nodes;
  const matches = (node) => node.name.toLowerCase().includes(needle);

  return nodes.flatMap((node) => {
    if (matches(node)) return [node];
    if (node.type === 'part') return [];
    const children = filterAssemblyTree(node.children, query);
    if (children.length === 0) return [];
    const partIds = children.flatMap((child) => child.partIds);
    return [{ ...node, children, partIds }];
  });
}
