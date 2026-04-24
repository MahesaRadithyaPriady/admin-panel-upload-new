import { NavLink, Outlet } from "react-router-dom";
import { Files, ListChecks, Clapperboard, Cpu } from "lucide-react";

function SidebarLink({ to, icon: Icon, label }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        [
          "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition",
          isActive
            ? "bg-zinc-100 text-black dark:bg-zinc-800 dark:text-zinc-50"
            : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
        ].join(" ")
      }
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
    </NavLink>
  );
}

export default function Layout() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black text-black dark:text-zinc-50">
      <div className="mx-auto max-w-7xl px-4 py-6">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_1fr]">
          <aside className="rounded-xl border bg-white dark:bg-zinc-900 p-3 h-fit lg:sticky lg:top-6">
            <div className="px-2 py-2">
              <div className="text-sm font-semibold">Admin Panel</div>
              <div className="text-xs opacity-70">Upload & Encode</div>
            </div>
            <nav className="mt-2 grid gap-1">
              <SidebarLink to="/" icon={Files} label="File Manager" />
              <SidebarLink to="/status" icon={ListChecks} label="Status" />
              <SidebarLink to="/convert" icon={Clapperboard} label="Convert" />
              <SidebarLink to="/convert-job" icon={Cpu} label="Convert Job" />
            </nav>
          </aside>

          <main className="min-w-0">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
