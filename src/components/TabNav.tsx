import { ArrowDownUp, LucideHome, Settings, Users, Box, Github, SlidersHorizontal, Coins, UserCog, Droplets } from 'lucide-react';
import ConnectWallet from '@/components/ConnectWalletButton';
import { Link } from 'react-router-dom';
import { useLocation } from 'react-router-dom';
import { ChangeMultisigFromNav } from './ChangeMultisigFromNav';

export default function TabNav() {
  const location = useLocation();
  const path = location.pathname;
  const tabs = [
    { name: 'Home', icon: <LucideHome />, route: '/' },
    { name: 'Transactions', icon: <ArrowDownUp />, route: '/transactions/' },
    { name: 'Limits', icon: <SlidersHorizontal />, route: '/limits/' },
    { name: 'Stake', icon: <Coins />, route: '/stake/' },
    { name: 'Members', icon: <UserCog />, route: '/members/' },
    { name: 'JitoSOL', icon: <Droplets />, route: '/jito/' },
    { name: 'Configuration', icon: <Users />, route: '/config/' },
    { name: 'Programs', icon: <Box />, route: '/programs/' },
    { name: 'Settings', icon: <Settings />, route: '/settings/' },
  ];

  const isTabActive = (route: string) =>
    (path!.startsWith(`${route}/`) && route !== '/') || route === path;

  return (
    <>
      <aside
        id="sidebar"
        className="z-40 hidden h-auto md:fixed md:left-0 md:top-0 md:block md:h-screen md:w-56"
        aria-label="Sidebar"
      >
        <div className="flex h-auto flex-col justify-between overflow-y-auto border-r border-primary/10 bg-black/50 px-3 py-5 backdrop-blur-xl md:h-full">
          <div>
            <Link to="/">
              <div className="mb-6 flex items-center px-3 py-2">
                <img src="/logo.png" width="140" height="auto" style={{ filter: 'brightness(0) invert(1)' }} />
              </div>
            </Link>
            <p className="holo-label px-3 pb-2">Console</p>
            <ul className="space-y-0.5 text-sm font-medium">
              {tabs.map((tab) => {
                const isActive = isTabActive(tab.route);
                return (
                  <li key={tab.route}>
                    <Link
                      to={tab.route}
                      className={`group relative flex items-center rounded-md px-3 py-2.5 transition-colors ${
                        isActive
                          ? 'bg-primary/10 text-primary'
                          : 'text-muted-foreground hover:bg-white/[0.04] hover:text-foreground'
                      }`}
                    >
                      {isActive && (
                        <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary shadow-[0_0_8px_hsl(187_85%_53%/0.8)]" />
                      )}
                      <span className="[&>svg]:h-4 [&>svg]:w-4">{tab.icon}</span>
                      <span className="ml-3 flex-1 whitespace-nowrap text-sm">
                        {tab.name}
                      </span>
                    </Link>
                  </li>
                );
              })}
              <li key="github-link" className="pt-1">
                <Link
                  to="https://github.com/Squads-Protocol/public-v4-client"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center rounded-md px-3 py-2.5 text-muted-foreground/70 transition-colors hover:bg-white/[0.04] hover:text-muted-foreground"
                >
                  <span className="[&>svg]:h-4 [&>svg]:w-4"><Github /></span>
                  <span className="ml-3 flex-1 whitespace-nowrap text-sm">GitHub</span>
                </Link>
              </li>
            </ul>
          </div>
          <div className="space-y-2 border-t border-primary/10 pt-4">
            <ConnectWallet />
            <ChangeMultisigFromNav />
          </div>
        </div>
      </aside>

      <aside
        id="mobile-navbar"
        className="fixed inset-x-0 bottom-0 z-50 block border-t border-primary/10 bg-black/70 p-2 backdrop-blur-xl md:hidden"
        aria-label="Mobile navbar"
      >
        <div className="mx-auto mt-1 grid h-full max-w-lg grid-cols-9 font-medium">
          {tabs.map((tab) => {
            const isActive = isTabActive(tab.route);
            return (
              <Link to={tab.route} key={tab.route} className="flex justify-center">
                <button
                  type="button"
                  className={`group inline-flex flex-col items-center justify-center rounded-md px-2 py-2 transition-colors ${
                    isActive ? 'text-primary' : 'text-muted-foreground/70 hover:text-foreground'
                  }`}
                >
                  {tab.icon}
                  <span className="mt-1 whitespace-nowrap text-[10px]">{tab.name}</span>
                </button>
              </Link>
            );
          })}
        </div>
      </aside>
    </>
  );
}
