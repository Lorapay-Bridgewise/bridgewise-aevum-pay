import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useEngine } from '../app/engine';
import { useLock } from '../app/lock';
import { isWeakPin, PIN_LENGTH, setPin } from '../security/pin';
import { useApp } from '../state/store';
import { Icon } from '../ui/icons';
import { Keypad, PinDots, Screen, ToggleRow } from '../ui/kit';
import { colors, radius, space, type } from '../ui/theme';

/** Choose the app PIN, type it again, and choose whether the fingerprint opens the app. */
export function CreatePinScreen() {
  const engine = useEngine();
  const canFinger = engine.deps.authKind() === 'biometric';
  const [first, setFirst] = useState<string | null>(null);
  const [pin, setPinText] = useState('');
  const [error, setError] = useState('');
  const [finger, setFinger] = useState(canFinger);
  const [saving, setSaving] = useState(false);

  async function key(k: string) {
    if (saving) return;
    setError('');
    const next = k === 'back' ? pin.slice(0, -1) : pin.length < PIN_LENGTH ? pin + k : pin;
    setPinText(next);
    if (next.length < PIN_LENGTH) return;
    if (first === null) {
      if (isWeakPin(next)) {
        setError('That PIN is easy to guess. Choose another.');
        setPinText('');
        return;
      }
      setFirst(next);
      setPinText('');
      return;
    }
    if (next !== first) {
      setError('The PINs did not match. Start again.');
      setFirst(null);
      setPinText('');
      return;
    }
    setSaving(true);
    try {
      await setPin(next);
    } catch (e) {
      setSaving(false);
      setFirst(null);
      setPinText('');
      setError(e instanceof Error ? e.message : 'Could not save your PIN. Try again.');
      return;
    }
    useApp.getState().setSettings({ biometricUnlock: canFinger && finger });
    useLock.getState().unlock();
    useApp.getState().setOnboarded(true);
  }

  return (
    <Screen scroll={false} gap={24}>
      <View style={styles.head}>
        <View style={styles.badge}>
          <Icon name="lock" size={28} color={colors.green} />
        </View>
        <Text style={[type.title, { textAlign: 'center' }]} accessibilityRole="header">
          {first === null ? 'Create a 6 digit PIN' : 'Type your PIN again'}
        </Text>
        <Text style={[type.body, { textAlign: 'center', fontSize: 15 }]}>You will use it to open the app.</Text>
      </View>
      <PinDots length={PIN_LENGTH} filled={pin.length} />
      {saving ? (
        <View style={styles.saving}>
          <ActivityIndicator color={colors.green} />
          <Text style={type.small}>Saving your PIN</Text>
        </View>
      ) : null}
      {error ? (
        <Text style={[type.small, { color: colors.red, textAlign: 'center' }]} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      {canFinger ? (
        <View style={styles.toggle}>
          <ToggleRow label="Open with fingerprint too" sub="Faster, and your PIN stays as a backup" value={finger} onChange={setFinger} last />
        </View>
      ) : null}
      <View style={{ flex: 1 }} />
      <Keypad onKey={key} keyHeight={60} testID="pin-pad" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { alignItems: 'center', gap: space(2.5), paddingTop: space(6) },
  badge: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center' },
  toggle: { backgroundColor: colors.card, borderRadius: radius.lg },
  saving: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 },
});
