import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useEngine } from '../app/engine';
import { useLock } from '../app/lock';
import { checkPin, PIN_LENGTH } from '../security/pin';
import { useApp } from '../state/store';
import { Avatar, Button, Keypad, PinDots, Screen } from '../ui/kit';
import { colors, space, type } from '../ui/theme';

export function LockScreen() {
  const engine = useEngine();
  const name = useApp(s => s.name);
  const finger = useApp(s => s.settings.biometricUnlock) && engine.deps.authKind() === 'biometric';
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  const tryFinger = useCallback(async () => {
    if (await engine.deps.unlock('Open Aevum Pay', 'Use your fingerprint')) useLock.getState().unlock();
  }, [engine.deps]);

  useEffect(() => {
    if (finger) void tryFinger();
  }, [finger, tryFinger]);

  async function key(k: string) {
    if (checking) return;
    setError('');
    const next = k === 'back' ? pin.slice(0, -1) : pin.length < PIN_LENGTH ? pin + k : pin;
    setPin(next);
    if (next.length < PIN_LENGTH) return;
    setChecking(true);
    const r = await checkPin(next);
    setChecking(false);
    setPin('');
    if (r.ok) {
      useLock.getState().unlock();
      return;
    }
    if (r.waitSec > 0) setError(`Too many wrong tries. Wait ${r.waitSec} seconds.`);
    else setError(r.triesLeft === 1 ? 'Wrong PIN. 1 try left before a wait.' : `Wrong PIN. ${r.triesLeft} tries left before a wait.`);
  }

  return (
    <Screen scroll={false} gap={24}>
      <View style={styles.head}>
        <Avatar name={name || 'A'} size={56} dark />
        <Text style={[type.title, { textAlign: 'center' }]} accessibilityRole="header">
          {name ? `Welcome back, ${name}` : 'Welcome back'}
        </Text>
        <Text style={[type.body, { textAlign: 'center', fontSize: 15 }]}>Enter your PIN</Text>
      </View>
      <PinDots length={PIN_LENGTH} filled={checking ? PIN_LENGTH : pin.length} />
      {checking ? <Text style={[type.small, { textAlign: 'center' }]}>Checking</Text> : null}
      {error ? (
        <Text style={[type.small, { color: colors.red, textAlign: 'center' }]} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      {finger ? <Button label="Use fingerprint" kind="quiet" icon="fingerprint" onPress={tryFinger} /> : null}
      <View style={{ flex: 1 }} />
      <Keypad onKey={key} keyHeight={60} testID="lock-pad" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { alignItems: 'center', gap: space(2.5), paddingTop: space(8) },
});
