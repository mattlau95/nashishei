export type Detection = {
  id: string
  bbox_x: number // normalized 0..1 from left edge
  bbox_y: number // normalized 0..1 from top edge
  bbox_w: number // normalized width
  bbox_h: number // normalized height
  source: 'auto' | 'manual'
}
