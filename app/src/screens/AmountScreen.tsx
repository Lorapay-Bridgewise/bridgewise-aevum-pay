import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEngine } from '../app/engine';
import type { RootStack } from '../app/navigation';
import { formatAmount, keypadInput, parseAmount, usd } from '../core/money';
import { lookUpName, spendable } from '../payments/engine';
import { contactFor, registeredName, useApp } from '../state/store';
import { Avatar, Button, Chip, Keypad, Notice, Screen, TopBar } from '../ui/kit';
import { whoIs } from '../ui/who';
import { colors, radius, space, type } from '../ui/theme';

type Props = NativeStackScreenProps<RootStack, 'Amount'>;

/** The most this phone can send right now: its per payment limit, today's limit, and the money (less the fee). */
export function maxNow(maxFee: bigint): bigint | null {
  const left = spendable();
  if (!left || left.revoked || left.expired) return null;
  const afterFee = left.balance - maxFee;
  const m = [left.perPaymentCap, left.todayLeft, afterFee < 0n ? 0n : afterFee].reduce((a, b) => (a < b ? a : b));
  return m;
}

export function AmountScreen({ navigation, route }: Props) {
  const { address, name: shared, amount: asked } = route.params;
  const engine = useEngine();
  const contacts = useApp(s => s.contacts);
  const contact = contactFor(contacts, address);
  const saved = useApp(s => registeredName(s.names, address));
  const onlyRegistered = useApp(s => !!s.settings.onlyRegistered);
  const [registered, setRegistered] = useState<string | null | undefined>(saved);
  useEffect(() => {
    let alive = true;
    lookUpName(engine.deps, address).then(n => alive && setRegistered(n)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [engine.deps, address]);
  const who = whoIs({ address, contactName: contact?.name, sharedName: shared, registered });
  const name = who.title.startsWith('0x') ? undefined : who.title;
  const blocked = onlyRegistered && !who.registered;
  const [text, setText] = useState(asked ? formatAmount(BigInt(asked)).replace(/,/g, '') : '');
  const units = parseAmount(text) ?? 0n;
  const most = maxNow(engine.deps.cfg.maxFeeUnits);
  const over = most !== null && units > most;
  const own = useApp(s => s.owner)?.toLowerCase() === address.toLowerCase();

  return (
    <Screen
      scroll={false}
      gap={18}
      header={<TopBar title="Pay" onBack={() => navigation.goBack()} />}
      footer={
        <Button
          label="Continue"
          disabled={units === 0n || over || most === null || own || blocked}
          onPress={() => navigation.navigate('Confirm', { address, name, amount: units.toString() })}
          testID="amount-continue"
        />
      }>
      <View style={styles.payee}>
        <Avatar name={name ?? '?'} size={48} />
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={[type.h2]} numberOfLines={1} testID="payee-name">
            {who.title}
          </Text>
          <Chip text={who.badge.text} tone={who.badge.tone} icon={who.badge.icon} />
          {who.note ? <Text style={type.small}>{who.note}</Text> : null}
        </View>
      </View>
      {who.warning ? <Notice tone="red" icon="alert" text={who.warning} /> : null}
      {blocked ? <Notice tone="red" text="You chose to pay only registered names. This person has no registered name." /> : null}

      <View style={styles.amount}>
        <Text style={[type.money, { fontSize: 64, lineHeight: 70, letterSpacing: -1.5 }]} testID="amount-text" accessibilityLabel={`Amount ${usd(units)}`}>
          ${text === '' ? '0' : text}
        </Text>
        {most === null ? (
          <Text style={type.small}>Turn on offline pay in Safety to pay.</Text>
        ) : (
          <Text style={[type.small, over ? { color: colors.red } : null]}>
            {over ? `That is more than you can send. Up to ${usd(most)} right now.` : `You can send up to ${usd(most)} right now`}
          </Text>
        )}
      </View>
      {own ? <Notice text="That is your own wallet." tone="red" /> : null}

      <Keypad point onKey={k => setText(t => keypadInput(t, k))} testID="amount-pad" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  payee: { backgroundColor: colors.card, borderRadius: radius.lg, paddingVertical: 14, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  amount: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space(2.5) },
});
