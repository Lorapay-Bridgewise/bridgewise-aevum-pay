import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEngine } from '../app/engine';
import type { RootStack } from '../app/navigation';
import { feeWords, usd } from '../core/money';
import { confirmAndPay, PayError } from '../payments/engine';
import { checkPin, PIN_LENGTH } from '../security/pin';
import { contactFor, registeredName, shortAddress, useApp } from '../state/store';
import { Icon } from '../ui/icons';
import { Button, Keypad, Notice, PinDots, Row } from '../ui/kit';
import { colors, radius, space, type } from '../ui/theme';

type Props = NativeStackScreenProps<RootStack, 'Confirm'>;

/**
 * Check before you pay. With a protected key the phone's own fingerprint prompt confirms (and
 * unlocks the key); otherwise the app PIN does.
 */
export function ConfirmScreen({ navigation, route }: Props) {
  const { address, name, amount } = route.params;
  const units = BigInt(amount);
  const insets = useSafeAreaInsets();
  const engine = useEngine();
  const { online, session, contacts } = useApp();
  const fee = engine.deps.cfg.maxFeeUnits;
  const kind = engine.deps.authKind();
  const usesFinger = !!session?.protected;
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const contact = contactFor(contacts, address);
  const registered = useApp(s => registeredName(s.names, address));

  async function payNow(pinChecked = false) {
    setBusy(true);
    setError('');
    try {
      const p = await confirmAndPay(engine.deps, { payee: address, amount: units, payeeName: name, pinChecked });
      navigation.popToTop();
      navigation.navigate('Payment', { id: p.id, fresh: true });
    } catch (e) {
      setError(e instanceof PayError ? e.message : 'The payment could not be signed on this phone. Nothing was sent.');
    } finally {
      setBusy(false);
    }
  }

  async function key(k: string) {
    if (busy) return;
    setError('');
    const next = k === 'back' ? pin.slice(0, -1) : pin.length < PIN_LENGTH ? pin + k : pin;
    setPin(next);
    if (next.length < PIN_LENGTH) return;
    const r = await checkPin(next);
    setPin('');
    if (r.ok) await payNow(true);
    else setError(r.waitSec > 0 ? `Too many wrong tries. Wait ${r.waitSec} seconds.` : 'Wrong PIN. Nothing was sent.');
  }

  return (
    <View style={styles.scrim}>
      <Pressable style={{ flex: 1 }} accessibilityLabel="Cancel" onPress={() => navigation.goBack()} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + space(6) }]} testID="confirm">
        <View style={styles.grip} />
        <Text style={[type.title, { fontSize: 24, lineHeight: 30 }]} accessibilityRole="header">
          Check before you pay
        </Text>

        <View style={styles.list}>
          <Row
            label="To"
            value={registered ?? name ?? shortAddress(address)}
            sub={registered ? 'Registered name' : contact ? 'Saved in your contacts' : undefined}
          />
          <Row label="Amount" value={usd(units)} />
          <Row label="Fee" value={`${feeWords(fee)} at most`} />
          <Row label="Total" value={`${usd(units + fee)}`} strong last />
        </View>

        {!online ? <Notice icon="noSignal" text="No signal. That is fine: nearby phones will carry the payment until one is online." /> : null}
        {error ? <Notice tone="red" text={error} /> : null}

        {usesFinger ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={kind === 'biometric' ? 'Touch the sensor to pay' : 'Confirm with your screen lock to pay'}
            onPress={() => payNow()}
            disabled={busy}
            style={styles.finger}
            testID="confirm-pay">
            <View style={styles.fingerBadge}>
              <Icon name={kind === 'biometric' ? 'fingerprint' : 'lock'} size={42} color={colors.green} width={1.6} />
            </View>
            <Text style={type.label}>{busy ? 'Paying' : kind === 'biometric' ? 'Touch to pay' : 'Confirm with your screen lock'}</Text>
          </Pressable>
        ) : (
          <View style={{ gap: space(3) }}>
            <Text style={[type.small, { textAlign: 'center' }]}>Enter your PIN to pay</Text>
            <PinDots length={PIN_LENGTH} filled={pin.length} />
            <Keypad onKey={key} keyHeight={48} testID="confirm-pad" />
          </View>
        )}

        <Button label="Cancel" kind="quiet" onPress={() => navigation.goBack()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: colors.scrim },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, paddingTop: 20, paddingHorizontal: 22, gap: 18 },
  grip: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#CFCBBE', alignSelf: 'center' },
  list: { backgroundColor: colors.card, borderRadius: radius.lg, paddingHorizontal: 16, paddingVertical: 4 },
  finger: { alignItems: 'center', gap: 10, padding: 8 },
  fingerBadge: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center' },
});
