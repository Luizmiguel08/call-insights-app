import { Link, useLocation } from "@tanstack/react-router";
import { Phone, BarChart3, Users, ListChecks, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const nav = [
    { to: "/", label: "Discador", icon: Phone },
    { to: "/fila", label: "Fila", icon: ListChecks },
    { to: "/dashboard", label: "Dashboard", icon: BarChart3 },
    { to: "/sessoes", label: "Sessões", icon: Activity },
    { to: "/corretores", label: "Corretores", icon: Users },
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-card/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          <Link to="/" className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-primary shadow-elegant">
              <Phone className="h-4 w-4 text-primary-foreground" />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="font-display text-base font-bold text-foreground">WarRoom</span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Discador</span>
            </div>
          </Link>
          <nav className="flex items-center gap-1">
            {nav.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.to;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors sm:px-3",
                    active
                      ? "bg-primary text-primary-foreground shadow-elegant"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden md:inline">{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
