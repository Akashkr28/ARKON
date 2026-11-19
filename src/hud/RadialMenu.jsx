import { useHandStore } from '../store/handStore';

export default function RadialMenu() {
  const menu = useHandStore((s) => s.menu);
  if (!menu) return null;

  return (
    <div className="radial-menu" style={{ left: menu.x, top: menu.y }}>
      <div className="radial-menu-ring" style={{ width: menu.radius * 2, height: menu.radius * 2 }} />
      {menu.items.map((item) => {
        const radians = (item.angle * Math.PI) / 180;
        const x = Math.cos(radians) * menu.radius;
        const y = Math.sin(radians) * menu.radius;
        return (
          <div
            key={item.id}
            className={`radial-menu-item${menu.highlighted === item.id ? ' is-active' : ''}`}
            style={{ transform: `translate(calc(${x}px - 50%), calc(${y}px - 50%))` }}
          >
            {item.label}
          </div>
        );
      })}
    </div>
  );
}
