import React from "react";
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Legend, Tooltip, ResponsiveContainer
} from "recharts";

/**
 * Expects data like:
 * [
 *   { lever: 'Pipeline Discipline', selectedScore: 63, topAvg: 75, bottomAvg: 54, lrsOverlay: 28 },
 *   ...
 * ]
 */
export default function RadarPentagon({
  data = [],
  showPerformance = false,
  showTop = false,
  showBottom = false,
  showLRS = false,
}) {
  // Tooltip to show per-lever values clearly
  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload) return null;
    const byKey = Object.fromEntries(payload.map(p => [p.dataKey, p.value]));
    return (
      <div style={{
        background: "white",
        border: "1px solid rgba(15,23,42,0.12)",
        borderRadius: 8,
        padding: "8px 10px",
        boxShadow: "0 8px 24px rgba(15,23,42,0.08)"
      }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>{label}</div>
        {showPerformance && typeof byKey.selectedScore === "number" && (
          <div>Performance : {Math.round(byKey.selectedScore)}</div>
        )}
        {showTop && typeof byKey.topAvg === "number" && (
          <div>Top : {Math.round(byKey.topAvg)}</div>
        )}
        {showBottom && typeof byKey.bottomAvg === "number" && (
          <div>Bottom : {Math.round(byKey.bottomAvg)}</div>
        )}
        {showLRS && typeof byKey.lrsOverlay === "number" && (
          <div>Enablement : {Math.round(byKey.lrsOverlay)}</div>
        )}
      </div>
    );
  };

  return (
    <div style={{ width: "100%", height: 520 }}>
      <ResponsiveContainer>
        <RadarChart data={data} outerRadius="75%">
          <PolarGrid gridType="polygon" />
          <PolarAngleAxis dataKey="lever" tick={{ fontSize: 12 }} />
          {/* >>> Fixed ticks so 35 sits clearly between 20 and 40 rings <<< */}
          <PolarRadiusAxis
            angle={90}
            domain={[0, 100]}
            ticks={[0, 20, 40, 60, 80, 100]}
            tick={{ fontSize: 10 }}
          />

          {showPerformance && (
            <Radar
              name="Performance"
              dataKey="selectedScore"
              fill="#2563eb" // blue-600
              fillOpacity={0.25}
              stroke="#2563eb"
              strokeWidth={2}
            />
          )}

          {showLRS && (
            <Radar
              name="Enablement"
              dataKey="lrsOverlay"
              fill="#7c3aed" // violet-600
              fillOpacity={0.25}
              stroke="#7c3aed"
              strokeWidth={2}
            />
          )}

          {showTop && (
            <Radar
              name="Top"
              dataKey="topAvg"
              fill="#10b981" // emerald-500
              fillOpacity={0.2}
              stroke="#10b981"
              strokeWidth={2}
            />
          )}

          {showBottom && (
            <Radar
              name="Bottom"
              dataKey="bottomAvg"
              fill="#ef4444" // red-500
              fillOpacity={0.18}
              stroke="#ef4444"
              strokeWidth={2}
            />
          )}

          <Tooltip content={<CustomTooltip />} />
          <Legend
            verticalAlign="bottom"
            height={36}
            wrapperStyle={{ fontSize: 12 }}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
