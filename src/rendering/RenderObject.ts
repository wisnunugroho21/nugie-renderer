/** Plain view of one render object (the SoA RenderWorld is the real storage). */
export interface RenderObject {
  entityId: number;
  meshId: number;
  materialId: number;
  transformIndex: number;
  boundsIndex: number;
  skinInstanceId: number;
  morphStateId: number;
  flags: number;
}
