import React from "react";

export default function Topbar({ activeMenu = "Sales" }) {
  // Menu items
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
          <img
            src="/assets/img/cpo-logo.png"
            alt="Chief Productivity Officer"
            style={{ height: 56, width: "auto", marginRight: 16 }}
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
        <div className="tabs" style={{ marginLeft: 48, flex: 1 }}>
          {menus.map((menu) => (
            <a
              key={menu.key}
              href="#"
              className={`tab${activeMenu === menu.key ? " active" : ""}`}
              style={{
                fontSize: 18,
                fontWeight: 600,
                padding: "10px 24px",
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
