import React from "react";

export default function Topbar({ activeMenu = "Sales" }) {
  const menus = [
    { name: "Home", key: "Home" },
    { name: "Sales", key: "Sales" },
    { name: "Customer Success", key: "Customer Success" },
    { name: "Production / Engineering", key: "Production / Engineering" },
  ];

  return (
    <div className="topbar">
      <div className="topbar-inner" style={{ minHeight: 90 }}>
        <div className="brand" style={{ minWidth: 0 }}>
          {/* Placeholder for logo: will fix in next step */}
          <div style={{ height: 56, width: 56, marginRight: 16 }}></div>
          <div>
            <div className="brand-title" style={{ fontSize: 28, fontWeight: 800 }}>
              Productivity OS
            </div>
            <div className="brand-sub" style={{ fontSize: 14 }}>
              Strengthen the competencies that move outcomes
            </div>
          </div>
        </div>
        <div className="tabs" style={{ marginLeft: 48, flex: 1, display: 'flex', gap: '12px' }}>
          {menus.map((menu) => (
            <a
              key={menu.key}
              href="#"
              className={`tab${activeMenu === menu.key ? " active" : ""}`}
              style={{
                fontSize: 16,                  // smaller font
                fontWeight: 600,
                padding: "6px 18px",           // less padding
                borderRadius: 8,
                transition: "background 0.2s",
                ...(activeMenu === menu.key
                  ? { background: "#fff", color: "#222" }
                  : {}),
              }}
            >
              {menu.name}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
