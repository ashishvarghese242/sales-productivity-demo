import React from 'react'
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Tooltip, ResponsiveContainer } from 'recharts'

export default function RadarPentagon({ data }) {
  return (
    <div className="w-full h-[480px]">
      <ResponsiveContainer>
        <RadarChart data={data} startAngle={-126} endAngle={234}>
          <PolarGrid gridType="polygon" radialLines={true} />
          <PolarAngleAxis dataKey="lever" />
          <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} />
          <Tooltip formatter={(val) => [`${Math.round(val)}`, 'Score']} />
          <Radar dataKey="score" stroke="#2563EB" fill="#2563EB" fillOpacity={0.35} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}
