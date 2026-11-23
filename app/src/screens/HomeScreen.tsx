import React, { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEngine } from '../app/engine';
import type { RootStack, Tabs } from '../app/navigation';
import { usd } from '../core/money';
import { addThisPhone, defaultLimits, makeReady, spendable } from '../payments/engine';
import { registeredName, shortAddress, useApp, type Incoming, type Payment } from '../state/store';
import { makeFeed } from '../ui/feed';
import { Icon, type IconName } from '../ui/icons';
import { Avatar, Button, Card, Chip, Notice, Screen, SectionTitle } from '../ui/kit';
import { lookOf, lookTone, lookWords, payeeLabel, whenText } from '../ui/paymentView';
import { colors, fonts, radius, space, type } from '../ui/theme';

type Props = CompositeScreenProps<BottomTabScreenProps<Tabs, 'Home'>, NativeStackScreenProps<RootStack>>;

function greeting(h = new Date().getHours()) {
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function HomeScreen({ navigation }: Props) {
  const engine = useEngine();
  const { name, online, snapshot, session, payments, incoming, names } = useApp();
  const feed = makeFeed(payments, incoming);
  const left = spendable();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const waiting = BigInt(snapshot?.walletUnits ?? '0');
  const ready = left?.balance ?? BigInt(snapshot?.vaultUnits ?? '0');
  const offlineOn = !!session && !!left && !left.revoked && !left.expired;

  async function act(f: () => Promise<{ ok: boolean; message?: string }>) {
    setBusy(true);
    setMessage(null);
    const r = await f().catch(() => ({ ok: false, message: 'That needs signal. Please try again.' }));
    setMessage({ text: r.message ?? '', ok: r.ok });
    setBusy(false);
  }

  return (
    <Screen onRefresh={engine.refresh} testID="home">
      <View style={styles.top}>
        <View style={styles.who}>
          <Avatar name={name || 'A'} size={40} dark />
          <View>
            <Text style={type.small}>{greeting()}</Text>
            <Text style={[type.h2]}>{name || 'Your wallet'}</Text>
          </View>
        </View>
        {online ? <Chip text="Online" tone="green" icon="signal" /> : <Chip text="No signal" tone="amber" icon="noSignal" />}
      </View>

      <View style={styles.balance} testID="balance">
        <Text style={{ fontFamily: fonts.regular, fontSize: 14, color: colors.onDeepMuted }}>Your balance</Text>
        <Text style={[type.money, { fontSize: 48, lineHeight: 52, color: '#FFFFFF', letterSpacing: -1 }]} accessibilityLabel={`Balance ${usd(ready + waiting)}`}>
          {usd(ready + waiting)}
        </Text>
        <View style={styles.balanceLine}>
          <Icon name={offlineOn ? 'shieldCheck' : 'alert'} size={18} color={colors.onDeep} />
          <Text style={{ fontFamily: fonts.regular, fontSize: 14, color: colors.onDeep, flex: 1 }}>
            {!offlineOn
              ? 'Offline pay is off on this phone.'
              : online
                ? `${usd(ready)} ready to pay, with or without signal.`
                : 'You can still pay without signal.'}
          </Text>
        </View>
      </View>

      {offlineOn && waiting >= 100_000n ? (
        <Card>
          <Text style={type.label}>{usd(waiting)} is not ready for offline yet</Text>
          <Text style={type.small}>Make it ready so you can spend it without signal. This needs signal now.</Text>
          <Button label="Make it ready" kind="secondary" busy={busy} disabled={!online} onPress={() => act(() => makeReady(engine.deps))} testID="make-ready" />
        </Card>
      ) : null}

      {!offlineOn ? (
        <Card>
          <Text style={type.label}>{left?.expired ? 'Offline pay needs renewing' : 'Turn on offline pay'}</Text>
          <Text style={type.small}>Up to $5 a payment and $10 a day, for 7 days. This needs signal now.</Text>
          <Button label="Turn on" busy={busy} disabled={!online} onPress={() => act(() => addThisPhone(engine.deps, defaultLimits(Date.now())))} testID="turn-on" />
        </Card>
      ) : null}

      {message?.text ? <Notice text={message.text} tone={message.ok ? 'green' : 'red'} /> : null}

      <View style={styles.actions}>
        <Action label="Scan to pay" icon="scan" primary onPress={() => navigation.navigate('Scan')} testID="go-scan" />
        <Action label="Pay someone" icon="send" onPress={() => navigation.navigate('Contacts')} testID="go-contacts" />
        <Action label="Receive" icon="receive" onPress={() => navigation.navigate('Receive')} testID="go-receive" />
      </View>

      <View style={{ gap: space(2) }}>
        <SectionTitle right={feed.length > 4 ? <Button label="See all" kind="quiet" onPress={() => navigation.navigate('Activity')} /> : undefined}>
          Recent
        </SectionTitle>
        {feed.length === 0 ? <Text style={type.small}>Money you send and receive shows here.</Text> : null}
        {feed.slice(0, 4).map(f =>
          f.out ? (
            <PaymentRow key={f.key} p={f.out} onPress={() => navigation.navigate('Payment', { id: f.out!.id })} />
          ) : (
            <IncomingRow key={f.key} i={f.in!} name={f.in!.fromName ?? (f.in!.from ? registeredName(names, f.in!.from) : null) ?? null} explorer={engine.deps.cfg.explorerUrl} />
          ),
        )}
      </View>
    </Screen>
  );
}

function Action({ label, icon, onPress, primary, testID }: { label: string; icon: IconName; onPress: () => void; primary?: boolean; testID?: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.action, primary ? styles.actionPrimary : styles.actionPlain, { opacity: pressed ? 0.85 : 1 }]}>
      <Icon name={icon} size={26} color={primary ? '#FFFFFF' : colors.ink} />
      <Text style={{ fontFamily: fonts.semibold, fontSize: 14, color: primary ? '#FFFFFF' : colors.ink, textAlign: 'center' }}>{label}</Text>
    </Pressable>
  );
}

export function PaymentRow({ p, onPress }: { p: Payment; onPress: () => void }) {
  const look = lookOf(p);
  const who = payeeLabel(p);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${who}, ${usd(BigInt(p.amount))}, ${lookWords[look]}`} onPress={onPress} style={styles.row} testID={`payment-${p.id}`}>
      <Avatar name={who} size={40} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={type.label} numberOfLines={1}>
          {who}
        </Text>
        <Text style={type.small}>{whenText(p.createdAt)}</Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Text style={[type.money, { fontSize: 16 }]}>-{usd(BigInt(p.amount))}</Text>
        <Chip text={look === 'failed' ? 'Not paid' : lookWords[look]} tone={lookTone[look]} />
      </View>
    </Pressable>
  );
}

/** Money someone paid this wallet. */
export function IncomingRow({ i, name, explorer }: { i: Incoming; name: string | null; explorer: string }) {
  const who = name ?? (i.from ? shortAddress(i.from) : 'Someone');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${who} paid you ${usd(BigInt(i.amount))}`}
      onPress={() => Linking.openURL(`${explorer}/tx/${i.txHash}`)}
      style={styles.row}
      testID={`incoming-${i.id}`}>
      <Avatar name={who} size={40} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={type.label} numberOfLines={1}>
          {who}
        </Text>
        <Text style={type.small}>{i.at ? whenText(i.at) : 'Received'}</Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Text style={[type.money, { fontSize: 16, color: colors.greenDark }]}>+{usd(BigInt(i.amount))}</Text>
        <Chip text="Received" tone="green" />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  who: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  balance: { backgroundColor: colors.deep, borderRadius: radius.xl, padding: 22, gap: 14 },
  balanceLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  actions: { flexDirection: 'row', gap: 12 },
  action: { flex: 1, borderRadius: 18, paddingVertical: 16, paddingHorizontal: 8, alignItems: 'center', gap: 8 },
  actionPrimary: { backgroundColor: colors.green },
  actionPlain: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  row: { backgroundColor: colors.card, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
});
