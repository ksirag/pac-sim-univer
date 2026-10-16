import L from 'leaflet';
import { useEffect, useRef } from 'react';
import { nearestLegIndex } from '../../core/routeModel';
import type { LatLng } from '../../core/types';
import { useMapColors } from '../map/colors';
import { PolylineLayer, StartEndMarkers, pinIcon, useMap } from '../map/LeafletMap';
import type { EditorState } from './useEditor';

export type Tool = 'points' | 'draw' | 'pan';

export interface EditorLayerProps {
  tool: Tool;
  state: EditorState;
  geometry: number[];
  selected: number | null;
  onAdd: (p: LatLng) => void;
  onMove: (index: number, p: LatLng) => void;
  onSelect: (index: number | null) => void;
  onInsert: (leg: number, p: LatLng) => void;
  onStroke: (flat: number[]) => void;
  onRawTap: () => void;
}

const MIN_STROKE_PX = 5;

/**
 * Интерактивный слой редактора: тап по карте добавляет точку, маркеры перетаскиваются,
 * тап по линии вставляет точку, в режиме «Рисовать» линия ведётся пальцем.
 */
export function EditorLayer(props: EditorLayerProps) {
  const map = useMap();
  const ref = useRef(props);
  useEffect(() => {
    ref.current = props;
  });
  const { tool, state, geometry, selected } = props;
  const colors = useMapColors();

  // тап по карте
  useEffect(() => {
    if (!map) return;
    const onClick = (e: L.LeafletMouseEvent) => {
      const p = ref.current;
      if (p.tool !== 'points') return;
      if (p.state.kind === 'raw' && p.state.raw.length > 0) {
        p.onRawTap();
        return;
      }
      p.onAdd({ lat: e.latlng.lat, lng: e.latlng.lng });
    };
    map.on('click', onClick);
    return () => {
      map.off('click', onClick);
    };
  }, [map]);

  // курсор / признаки режима
  useEffect(() => {
    if (!map) return;
    const c = map.getContainer();
    c.classList.toggle('tool-points', tool === 'points');
    c.classList.toggle('tool-draw', tool === 'draw');
    return () => c.classList.remove('tool-points', 'tool-draw');
  }, [map, tool]);

  // опорные точки
  const control = state.kind === 'path' ? state.path.control : null;
  useEffect(() => {
    if (!map || !control) return;
    const markers: L.Marker[] = [];
    control.forEach((p, i) => {
      const isStart = i === 0;
      const isEnd = i === control.length - 1 && control.length > 1;
      const kind = selected === i ? 'selected' : isStart ? 'start' : isEnd ? 'end' : 'point';
      const text = kind === 'start' ? 'С' : kind === 'end' ? 'Ф' : String(i + 1);
      const draggable = tool === 'points';
      const m = L.marker([p.lat, p.lng], {
        icon: pinIcon(kind, text),
        draggable,
        interactive: draggable,
        keyboard: draggable,
        autoPan: true,
        title: `Точка ${i + 1} из ${control.length}`,
        zIndexOffset: selected === i ? 900 : isStart || isEnd ? 600 : 400,
      });
      m.on('click', () => ref.current.onSelect(ref.current.selected === i ? null : i));
      m.on('dragstart', () => ref.current.onSelect(null));
      m.on('dragend', () => {
        const ll = m.getLatLng();
        ref.current.onMove(i, { lat: ll.lat, lng: ll.lng });
      });
      m.addTo(map);
      markers.push(m);
    });
    return () => markers.forEach((m) => m.remove());
  }, [map, control, selected, tool]);

  // рисование от руки
  useEffect(() => {
    if (!map || tool !== 'draw') return;
    const runColor = colors.run;
    const container = map.getContainer();
    map.dragging.disable();
    map.touchZoom.disable();
    map.doubleClickZoom.disable();
    let points: L.Point[] = [];
    let latlngs: L.LatLng[] = [];
    let pointerId: number | null = null;
    const temp = L.polyline([], { color: runColor, weight: 5, opacity: 0.9, interactive: false }).addTo(map);

    const down = (e: PointerEvent) => {
      if (pointerId !== null || !e.isPrimary) return;
      if ((e.target as HTMLElement).closest('.leaflet-control, .map-controls')) return;
      pointerId = e.pointerId;
      container.setPointerCapture(e.pointerId);
      const pt = map.mouseEventToContainerPoint(e as unknown as MouseEvent);
      points = [pt];
      latlngs = [map.containerPointToLatLng(pt)];
      temp.setLatLngs(latlngs);
      e.preventDefault();
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      const pt = map.mouseEventToContainerPoint(e as unknown as MouseEvent);
      const last = points[points.length - 1]!;
      if (pt.distanceTo(last) < MIN_STROKE_PX) return;
      points.push(pt);
      latlngs.push(map.containerPointToLatLng(pt));
      temp.setLatLngs(latlngs);
      e.preventDefault();
    };
    const end = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      pointerId = null;
      const flat: number[] = [];
      for (const ll of latlngs) flat.push(ll.lat, ll.lng);
      points = [];
      latlngs = [];
      temp.setLatLngs([]);
      if (flat.length >= 4) ref.current.onStroke(flat);
    };
    container.addEventListener('pointerdown', down);
    container.addEventListener('pointermove', move);
    container.addEventListener('pointerup', end);
    container.addEventListener('pointercancel', end);
    return () => {
      container.removeEventListener('pointerdown', down);
      container.removeEventListener('pointermove', move);
      container.removeEventListener('pointerup', end);
      container.removeEventListener('pointercancel', end);
      temp.remove();
      map.dragging.enable();
      map.touchZoom.enable();
      map.doubleClickZoom.enable();
    };
  }, [map, tool, colors.run]);

  const canInsert = tool === 'points' && state.kind === 'path' && state.path.control.length >= 2;
  return (
    <>
      <PolylineLayer
        coords={geometry}
        color={colors.brand}
        weight={6}
        interactive={canInsert}
        onClick={(e) => {
          L.DomEvent.stopPropagation(e);
          if (!canInsert) return;
          const p = { lat: e.latlng.lat, lng: e.latlng.lng };
          ref.current.onInsert(nearestLegIndex(state.path, p), p);
        }}
      />
      {state.kind === 'raw' ? <StartEndMarkers coords={geometry} /> : null}
    </>
  );
}
