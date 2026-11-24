import { describe, expect, it } from 'vitest';
import { Group, Mesh } from 'three';
import {
  describeEdge,
  describeFace,
  describeItem,
  faceAtTriangle,
  primitiveIndexOf,
  productForSpec,
} from '../src/models/partFaces.js';

const product = {
  faces: [
    { type: 'plane', area: 176800, normal: [0, 0, 1], tri: [0, 0, 2] },
    { type: 'cylinder', area: 62832, radius: 40, concave: true, sweep: 360, length: 250, tri: [0, 2, 40] },
    { type: 'cylinder', area: 157, radius: 5, concave: false, sweep: 90, length: 20, tri: [1, 0, 8] },
  ],
  edges: [
    { type: 'line', length: 520, points: [0, 0, 0, 0.52, 0, 0] },
    { type: 'circle', length: 251.327, radius: 40, full: true, points: [] },
    { type: 'circle', length: 7.854, radius: 5, full: false, points: [] },
  ],
};
const doc = { products: [product], parts: [0, null] };

describe('finding faces', () => {
  it('maps a part to its product', () => {
    expect(productForSpec(doc, 0)).toBe(product);
    expect(productForSpec(doc, 1)).toBe(null); // part that couldn't be mapped
    expect(productForSpec(null, 0)).toBe(null);
  });

  it('finds the face owning a triangle, per primitive', () => {
    expect(faceAtTriangle(product, 0, 0)).toBe(0);
    expect(faceAtTriangle(product, 0, 1)).toBe(0);
    expect(faceAtTriangle(product, 0, 2)).toBe(1);
    expect(faceAtTriangle(product, 0, 41)).toBe(1);
    expect(faceAtTriangle(product, 0, 42)).toBe(-1);
    expect(faceAtTriangle(product, 1, 3)).toBe(2);
    expect(faceAtTriangle(product, 0, undefined)).toBe(-1);
  });

  it('tells which primitive a mesh draws', () => {
    const single = new Mesh();
    single.userData.specIndex = 4;
    expect(primitiveIndexOf(single)).toBe(0);
    const node = new Group();
    node.userData.specIndex = 5;
    const [first, second] = [new Mesh(), new Mesh()];
    node.add(first, second);
    expect(primitiveIndexOf(second)).toBe(1);
  });
});

describe('describing faces and edges', () => {
  it('names holes, rounds and flat faces with their sizes', () => {
    expect(describeFace(product.faces[0])).toEqual({
      title: 'Flat face',
      details: ['Area 176,800 mm²', 'Facing +Z (Y up)'],
    });
    expect(describeFace(product.faces[1]).title).toBe('Hole Ø80.0 mm');
    expect(describeFace(product.faces[1]).details).toContain('Length 250.0 mm');
    expect(describeFace(product.faces[2]).title).toBe('Round R5.0 mm');
    expect(describeFace({ ...product.faces[2], concave: true }).title).toBe('Fillet R5.0 mm');
    expect(describeFace({ type: 'freeform', area: 10 }).title).toBe('Freeform surface');
  });

  it('names straight, circular and arc edges, in the chosen unit', () => {
    expect(describeEdge(product.edges[0]).details).toEqual(['Length 520.0 mm']);
    expect(describeEdge(product.edges[1]).title).toBe('Circular edge Ø80.0 mm');
    expect(describeEdge(product.edges[2]).title).toBe('Arc R5.0 mm');
    expect(describeEdge(product.edges[1], 'in').title).toBe('Circular edge Ø3.150 in');
  });

  it('describes a hovered item, or nothing', () => {
    expect(describeItem(product, { kind: 'edge', index: 1 }).title).toBe('Circular edge Ø80.0 mm');
    expect(describeItem(product, { kind: 'face', index: 9 })).toBe(null);
    expect(describeItem(null, { kind: 'face', index: 0 })).toBe(null);
  });
});
