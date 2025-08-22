import React from "react";

export default function Topbar({ activeMenu = "Sales" }) {
  const menus = [
    { name: "Home", key: "Home" },
    { name: "Sales", key: "Sales" },
    { name: "Customer Success", key: "Customer Success" },
    { name: "Production / Engineering", key: "Production / Engineering" },
  ];

  return (
    <div className="topbar" style={{ minHeight: 96, padding: "0 32px" }}>
      <div className="topbar-inner" style={{ display: "flex", alignItems: "center", minHeight: 96 }}>
        <div className="brand" style={{ display: "flex", alignItems: "center", minWidth: 0 }}>
          <img
            src="/assets/img/cpo-logo.png"
            alt="Chief Productivity Officer"
            style={{
              height: 56,
              width: "auto",
              marginRight: 20,
              display: "block"
            }}
          />
          <div>
            <div className="brand-title" style={{ fontSize: 28, fontWeight: 800 }}>
              Productivity OS
            </div>
            <div className="brand-sub" style={{ fontSize: 14 }}>
              Strengthen the competencies that move outcomes
            </div>
          </div>
        </div>
        <div className="tabs" style={{
          marginLeft: 48,
          flex: 1,
          display: 'flex',
          gap: '8px',
          justifyContent: 'flex-start',
        }}>
          {menus.map((menu) => (
            <a
              key={menu.key}
              href="#"
              className={`tab${activeMenu === menu.key ? " active" : ""}`}
              style={{
                fontSize: 15,                  // smaller font
                fontWeight: 600,
                padding: "4px 16px",           // less padding
                borderRadius: 8,
                transition: "background 0.2s",
                ...(activeMenu === menu.key
                  ? { background: "#fff", color: "#222", boxShadow: "0 2px 8px 0 rgba(0,0,0,0.04)" }
                  : { background: "rgba(255,255,255,0.12)", color: "#fff" }),
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
