const MINIMAP_WIDTH = 140;
const MINIMAP_HEIGHT = 96;
const PADDING = 6;

export interface MinimapNode {
  x: number;
  y: number;
  color: string;
}

export interface MinimapViewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Small fixed-size overview of node positions, top-right of the canvas.
 * Bounds are derived from the nodes themselves (not the full layout), so it
 * degrades gracefully for both the static Tree layout and the freely-moving
 * Cluster force simulation. A `viewport` rect is optional — Tree mode can
 * compute one exactly from its pan/zoom state; Cluster mode (whose pan
 * offset isn't exposed by react-force-graph's public API) omits it and
 * shows node positions only. */
export function GraphMinimap({
  nodes,
  viewport,
  onNavigate,
}: {
  nodes: MinimapNode[];
  viewport?: MinimapViewport;
  onNavigate?: (contentX: number, contentY: number) => void;
}) {
  if (nodes.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.y > maxY) maxY = n.y;
  }
  if (viewport) {
    minX = Math.min(minX, viewport.x);
    minY = Math.min(minY, viewport.y);
    maxX = Math.max(maxX, viewport.x + viewport.width);
    maxY = Math.max(maxY, viewport.y + viewport.height);
  }
  const contentWidth = Math.max(1, maxX - minX);
  const contentHeight = Math.max(1, maxY - minY);
  const scale = Math.min(
    (MINIMAP_WIDTH - PADDING * 2) / contentWidth,
    (MINIMAP_HEIGHT - PADDING * 2) / contentHeight
  );

  const toMap = (x: number, y: number) => ({
    mx: PADDING + (x - minX) * scale,
    my: PADDING + (y - minY) * scale,
  });

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!onNavigate) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    onNavigate(minX + (mx - PADDING) / scale, minY + (my - PADDING) / scale);
  };

  return (
    <svg
      width={MINIMAP_WIDTH}
      height={MINIMAP_HEIGHT}
      className="absolute top-3 right-3 z-10 rounded-lg border"
      style={{ background: "rgba(22,27,34,0.9)", borderColor: "#21262d", cursor: onNavigate ? "pointer" : "default" }}
      onClick={handleClick}
    >
      {viewport && (
        <rect
          x={toMap(viewport.x, viewport.y).mx}
          y={toMap(viewport.x, viewport.y).my}
          width={viewport.width * scale}
          height={viewport.height * scale}
          fill="rgba(59,130,246,0.12)"
          stroke="#3b82f6"
          strokeWidth={1}
        />
      )}
      {nodes.map((n, i) => {
        const { mx, my } = toMap(n.x, n.y);
        return <circle key={i} cx={mx} cy={my} r={1.6} fill={n.color} />;
      })}
    </svg>
  );
}
