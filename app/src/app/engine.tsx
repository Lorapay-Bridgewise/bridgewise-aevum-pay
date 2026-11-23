import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { appDeps, deliverOpen, refreshIncoming, refreshNames, refreshWallet, type Deps } from '../payments/engine';
import { meshStateText, startMesh, enableMesh, getMesh, type MeshState } from '../mesh';
import { useApp } from '../state/store';

type Engine = {
  deps: Deps;
  mesh: MeshState | 'starting';
  meshText: string;
  peers: number;
  turnOnMesh(): Promise<void>;
  refresh(): Promise<boolean>;
};

const Ctx = createContext<Engine | null>(null);

/** Everything worth reading while online: balances, money in, registered names. */
async function refreshAll(deps: Deps): Promise<boolean> {
  const ok = await refreshWallet(deps);
  if (ok) {
    await refreshIncoming(deps).catch(() => undefined);
    await refreshNames(deps).catch(() => undefined);
  }
  return ok;
}

/** Starts the mesh, keeps the wallet fresh while online, and keeps trying open payments. */
export function EngineProvider({ children, deps: given }: { children: React.ReactNode; deps?: Deps }) {
  const deps = useMemo(() => given ?? appDeps(), [given]);
  const [mesh, setMesh] = useState<MeshState | 'starting'>('starting');
  const [peers, setPeers] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      const owner = await deps.owner();
      useApp.getState().setOwner(owner.address);
      const s = await startMesh(deps.cfg).catch(() => 'failed' as const);
      if (alive) setMesh(s);
      await refreshAll(deps);
      await deliverOpen(deps);
    })();
    const off = getMesh().onPeersChanged(n => alive && setPeers(n));
    const tick = setInterval(async () => {
      await refreshAll(deps);
      await deliverOpen(deps);
    }, 20_000);
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') void refreshAll(deps).then(() => deliverOpen(deps));
    });
    return () => {
      alive = false;
      off();
      clearInterval(tick);
      sub.remove();
    };
  }, [deps]);

  const value: Engine = {
    deps,
    mesh,
    meshText: mesh === 'starting' ? 'Starting the mesh' : meshStateText(mesh),
    peers,
    turnOnMesh: async () => setMesh(await enableMesh(deps.cfg)),
    refresh: () => refreshAll(deps),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEngine(): Engine {
  const e = useContext(Ctx);
  if (!e) throw new Error('useEngine outside EngineProvider');
  return e;
}
