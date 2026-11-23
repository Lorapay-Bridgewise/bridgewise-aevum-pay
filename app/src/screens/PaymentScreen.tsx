import React, { useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEngine } from '../app/engine';
import type { RootStack } from '../app/navigation';
import { usd } from '../core/money';
import { deliver } from '../payments/engine';
import { contactFor, useApp } from '../state/store';
import { Icon, type IconName } from '../ui/icons';
import { Button, Card, Row, Screen, TopBar } from '../ui/kit';
import { headline, lookOf, payeeLabel, timeline } from '../ui/paymentView';
import { colors, fonts, space, type } from '../ui/theme';

type Props = NativeStackScreenProps<RootStack, 'Payment'>;

const badge: Record<string, { bg: string; fg: string; icon: IconName }> = {
  paid: { bg: colors.paidSoft, fg: colors.greenDark, icon: 'check' },
  sending: { bg: colors.amberSoft, fg: colors.amberText, icon: 'pulse' },
  failed: { bg: colors.redSoft, fg: colors.red, icon: 'alert' },
};

export function PaymentScreen({ navigation, route }: Props) {
  const engine = useEngine();
  const p = useApp(s => s.payments.find(x => x.id === route.params.id));
  const contacts = useApp(s => s.contacts);
  const [details, setDetails] = useState(false);
  const [trying, setTrying] = useState(false);

  const close = () => (route.params.fresh ? navigation.navigate('Tabs') : navigation.goBack());

  if (!p) {
    return (
      <Screen header={<TopBar onBack={close} />}>
        <Text style={type.body}>This payment is not on this phone.</Text>
      </Screen>
    );
  }

  const look = lookOf(p);
  const b = badge[look];
  const h = headline(p);
  const steps = timeline(p);
  const saved = !!contactFor(contacts, p.payee);

  return (
    <Screen
      header={<TopBar onBack={close} icon={route.params.fresh ? 'close' : 'back'} />}
      footer={
        <>
          {look === 'failed' ? (
            <Button label="Pay again" onPress={() => navigation.replace('Amount', { address: p.payee, name: p.payeeName })} testID="pay-again" />
          ) : null}
          <Button label="Done" kind={look === 'failed' ? 'secondary' : 'primary'} onPress={close} testID="payment-done" />
        </>
      }>
      <View style={styles.head} testID={`look-${look}`}>
        <View style={[styles.badge, { backgroundColor: b.bg }]}>
          <Icon name={b.icon} size={44} color={b.fg} width={2.4} />
        </View>
        <Text style={[type.title, { fontSize: 30, textAlign: 'center' }]} accessibilityRole="header">
          {h.title}
        </Text>
        <Text style={[type.body, { textAlign: 'center', maxWidth: 300 }]}>{h.sub}</Text>
      </View>

      <Card style={styles.who}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={type.small}>To</Text>
          <Text style={type.h2} numberOfLines={1}>
            {payeeLabel(p)}
          </Text>
        </View>
        <Text style={[type.money, { fontSize: 24 }]}>{usd(BigInt(p.amount))}</Text>
      </Card>

      <View style={{ paddingHorizontal: 4 }}>
        {steps.map((s, i) => (
          <View key={i} style={styles.step}>
            <View style={{ alignItems: 'center' }}>
              <View style={[styles.dot, s.done ? styles.dotDone : s.current ? styles.dotNow : styles.dotLater]}>
                {s.done ? <Icon name="check" size={12} color="#FFFFFF" width={3.5} /> : null}
              </View>
              {i < steps.length - 1 ? <View style={styles.line} /> : null}
            </View>
            <View style={{ flex: 1, gap: 2, paddingBottom: 14 }}>
              <Text style={[type.label, { color: s.done || s.current ? colors.ink : colors.muted }]}>{s.title}</Text>
              {s.when ? <Text style={type.small}>{s.when}</Text> : null}
            </View>
          </View>
        ))}
      </View>

      {look === 'sending' ? (
        <Button
          label="Try again now"
          kind="secondary"
          busy={trying}
          onPress={async () => {
            setTrying(true);
            await deliver(engine.deps, p.id);
            setTrying(false);
          }}
        />
      ) : null}
      {!saved ? (
        <Button label="Save to contacts" kind="quiet" icon="plus" onPress={() => navigation.navigate('AddContact', { address: p.payee, name: p.payeeName })} />
      ) : null}

      <Button label={details ? 'Hide details' : 'Details'} kind="quiet" onPress={() => setDetails(d => !d)} testID="details" />
      {details ? (
        <Card>
          <Row label="Wallet address" value={`${p.payee.slice(0, 10)}…${p.payee.slice(-6)}`} />
          <Row label="Fee" value={p.fee ? usd(BigInt(p.fee)) : `up to ${usd(BigInt(p.maxFee))}`} />
          <Row label="Tries" value={String(p.attempts)} last={!p.txHash} />
          {p.txHash ? (
            <Button
              label="View on the Aevum explorer"
              kind="quiet"
              onPress={() => Linking.openURL(`${engine.deps.cfg.explorerUrl}/tx/${p.txHash}`)}
            />
          ) : null}
          <Text style={[type.small, { fontFamily: fonts.regular }]}>
            Paid in tUSD8, a test dollar on the Aevum test network. Signed with a key in this phone's secure chip, so nobody on the way can change it.
          </Text>
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { alignItems: 'center', gap: 14, paddingTop: space(4) },
  badge: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center' },
  who: { flexDirection: 'row', alignItems: 'center' },
  step: { flexDirection: 'row', gap: 14 },
  dot: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  dotDone: { backgroundColor: colors.green, borderColor: colors.green },
  dotNow: { backgroundColor: '#FFFFFF', borderColor: '#C9771B' },
  dotLater: { backgroundColor: '#FFFFFF', borderColor: '#CFCBBE' },
  line: { width: 2, height: 34, backgroundColor: '#DAD6CB' },
});
