import React, { useState } from 'react';
import { Alert, Linking, StyleSheet, Text, View } from 'react-native';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEngine } from '../app/engine';
import { useLock } from '../app/lock';
import type { RootStack, Tabs } from '../app/navigation';
import { usd, usdShort } from '../core/money';
import { addThisPhone, defaultLimits, registerMyName, releaseMyName, removeThisPhone, spendable, withdrawAll } from '../payments/engine';
import { registeredName, useApp } from '../state/store';
import { Button, Card, Chip, Field, LinkRow, Notice, Row, Screen, ToggleRow } from '../ui/kit';
import { nameProblem } from '../core/owner';
import { colors, radius, space, type } from '../ui/theme';

type Props = CompositeScreenProps<BottomTabScreenProps<Tabs, 'Safety'>, NativeStackScreenProps<RootStack>>;

const dateText = (sec: number) => new Date(sec * 1000).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

export function SafetyScreen({ navigation }: Props) {
  const engine = useEngine();
  const { session, settings, online, owner, snapshot, registry, name } = useApp();
  const myRegistered = useApp(s => (s.owner ? registeredName(s.names, s.owner) : undefined));
  const [wanted, setWanted] = useState(name);
  const left = spendable();
  const on = !!session && !!left && !left.revoked && !left.expired;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const finger = engine.deps.authKind() === 'biometric';

  async function act(f: () => Promise<{ ok: boolean; message?: string }>) {
    setBusy(true);
    setMessage(null);
    const r = await f().catch(() => ({ ok: false, message: 'That needs signal. Please try again.' }));
    setMessage({ text: r.message ?? '', ok: r.ok });
    setBusy(false);
  }

  return (
    <Screen gap={14} onRefresh={engine.refresh} testID="safety">
      <Text style={type.title} accessibilityRole="header">
        Safety
      </Text>

      <Card>
        <View style={styles.between}>
          <Text style={type.h2}>Offline pay on this phone</Text>
          {on ? <Chip text="On" tone="green" /> : left?.expired ? <Chip text="Needs renewing" tone="amber" /> : <Chip text="Off" tone="grey" />}
        </View>
        {on && left ? (
          <>
            <View style={styles.tiles}>
              <Tile label="Each payment" value={`up to ${usdShort(left.perPaymentCap)}`} />
              <Tile label="Left today" value={`${usdShort(left.todayLeft)} of ${usdShort(BigInt(snapshot?.session?.dailyCap ?? '0'))}`} />
            </View>
            <Text style={[type.body, { fontSize: 14 }]}>Renews on {dateText(left.expiresAt)}. Before then, open the app once with signal.</Text>
            <Button label="Change limits" kind="secondary" disabled={!online} onPress={() => navigation.navigate('Limits')} testID="change-limits" />
          </>
        ) : (
          <>
            <Text style={[type.body, { fontSize: 14 }]}>Turn it on to pay without signal, with safe limits: up to $5 a payment and $10 a day.</Text>
            <Button label="Turn on" busy={busy} disabled={!online} onPress={() => act(() => addThisPhone(engine.deps, defaultLimits(Date.now())))} />
          </>
        )}
      </Card>

      {message?.text ? <Notice text={message.text} tone={message.ok ? 'green' : 'red'} /> : null}

      {registry ? (
        <Card>
          <View style={styles.between}>
            <Text style={type.h2}>Your registered name</Text>
            {myRegistered ? <Chip text="Registered" tone="green" icon="shieldCheck" /> : <Chip text="Not registered" tone="grey" />}
          </View>
          {myRegistered ? (
            <>
              <Text style={[type.body, { fontSize: 15 }]}>
                People who pay you see "{myRegistered}" with a green mark, so they know the code is really yours.
              </Text>
              <Button label="Give up this name" kind="danger" busy={busy} disabled={!online} onPress={() => act(() => releaseMyName(engine.deps))} />
            </>
          ) : (
            <>
              <Text style={[type.body, { fontSize: 15 }]}>Register a name so people who pay you see it marked as yours. One name per wallet, first come, first served.</Text>
              <Field label="Name" value={wanted} onChangeText={setWanted} maxLength={32} error={wanted && nameProblem(wanted) ? nameProblem(wanted)! : undefined} testID="register-name" />
              <Button
                label="Register this name"
                busy={busy}
                disabled={!online || !!nameProblem(wanted)}
                onPress={() => act(() => registerMyName(engine.deps, wanted.trim()))}
                testID="register-name-go"
              />
            </>
          )}
        </Card>
      ) : null}

      <View style={styles.group}>
        {registry ? (
          <ToggleRow
            label="Only pay registered names"
            sub="Refuse payments to anyone without a registered name, even offline"
            value={!!settings.onlyRegistered}
            onChange={v => useApp.getState().setSettings({ onlyRegistered: v })}
          />
        ) : null}
        {finger ? (
          <ToggleRow
            label="Open with fingerprint"
            sub="Your PIN always works too"
            value={settings.biometricUnlock}
            onChange={v => useApp.getState().setSettings({ biometricUnlock: v })}
          />
        ) : null}
        <ToggleRow
          label="Show technical details"
          sub="Addresses and network links"
          value={settings.showTechnical}
          onChange={v => useApp.getState().setSettings({ showTechnical: v })}
          last
        />
      </View>
      <Text style={[type.small, { paddingHorizontal: 4 }]}>
        {session?.protected
          ? 'Every payment needs your fingerprint or screen lock. The phone’s secure chip checks it, not just this app.'
          : 'This phone has no screen lock, so payments are confirmed with your app PIN. Add a screen lock in your phone settings for stronger protection.'}
      </Text>

      <View style={styles.group}>
        <LinkRow
          label="Move offline money back to my balance"
          onPress={() =>
            online
              ? act(() => withdrawAll(engine.deps))
              : setMessage({ text: 'That needs signal.', ok: false })
          }
        />
        <LinkRow label="Lock the app now" onPress={() => useLock.getState().lock()} />
        {on ? (
          <LinkRow
            label="Turn off offline pay on this phone"
            tone="red"
            last
            testID="turn-off"
            onPress={() =>
              Alert.alert('Turn off offline pay?', 'This phone will not be able to pay without signal until you turn it on again. Payments still on their way will be refused.', [
                { text: 'Keep it on', style: 'cancel' },
                { text: 'Turn off', style: 'destructive', onPress: () => act(() => removeThisPhone(engine.deps)) },
              ])
            }
          />
        ) : null}
      </View>

      {settings.showTechnical ? (
        <Card>
          <Text style={type.h2}>Technical details</Text>
          <Row label="Wallet" value={owner ? `${owner.slice(0, 8)}…${owner.slice(-6)}` : 'not created'} />
          <Row label="Offline money" value={usd(BigInt(snapshot?.vaultUnits ?? '0'))} />
          <Row label="Payment key" value={session ? (session.hardware ? 'In secure hardware' : 'Software only') : 'none'} />
          <Row label="Network" value="Aevum testnet (tUSD8)" last />
          <Button label="See all payments on the network" kind="quiet" onPress={() => Linking.openURL(`${engine.deps.cfg.agentUrl}/activity`)} />
        </Card>
      ) : null}
    </Screen>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.tile}>
      <Text style={type.small}>{label}</Text>
      <Text style={[type.money, { fontSize: 20 }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space(2) },
  tiles: { flexDirection: 'row', gap: 10 },
  tile: { flex: 1, backgroundColor: colors.bg, borderRadius: 12, padding: 12, gap: 4 },
  group: { backgroundColor: colors.card, borderRadius: radius.lg },
});
