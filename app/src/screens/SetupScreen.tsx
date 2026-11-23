import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEngine } from '../app/engine';
import type { RootStack } from '../app/navigation';
import { usdShort } from '../core/money';
import { defaultLimits, setUpWallet, type SetupStep, type StepState } from '../payments/engine';
import { useApp } from '../state/store';
import { Icon } from '../ui/icons';
import { Button, Card, Field, Screen } from '../ui/kit';
import { colors, fonts, space, type } from '../ui/theme';

type Props = NativeStackScreenProps<RootStack, 'Setup'>;

const TITLES: Record<SetupStep, { title: string; doing: string }> = {
  wallet: { title: 'Wallet created', doing: 'Creating your wallet' },
  money: { title: 'Test money added', doing: 'Getting free test money' },
  offline: { title: 'Offline pay is on', doing: 'Turning on offline pay' },
};
const ORDER: SetupStep[] = ['wallet', 'money', 'offline'];

export function SetupScreen({ navigation }: Props) {
  const engine = useEngine();
  const savedName = useApp(s => s.name);
  const [name, setName] = useState(savedName);
  const [phase, setPhase] = useState<'name' | 'running' | 'done' | 'failed'>('name');
  const [steps, setSteps] = useState<Partial<Record<SetupStep, StepState>>>({});
  const limits = defaultLimits(Date.now());

  async function run() {
    useApp.getState().setName(name);
    setPhase('running');
    const ok = await setUpWallet(engine.deps, (step, s) => setSteps(prev => ({ ...prev, [step]: s })));
    if (ok) await engine.turnOnMesh().catch(() => undefined);
    setPhase(ok ? 'done' : 'failed');
  }

  if (phase === 'name') {
    return (
      <Screen
        footer={<Button label="Set up my wallet" onPress={run} disabled={name.trim().length === 0} testID="start-setup" />}>
        <View style={styles.head}>
          <Text style={type.title} accessibilityRole="header">
            What should we call you?
          </Text>
          <Text style={type.body}>People see this name when you ask them to pay you.</Text>
        </View>
        <Field label="Your name" value={name} onChangeText={setName} placeholder="For example, Ada" autoFocus maxLength={40} testID="name" returnKeyType="done" />
      </Screen>
    );
  }

  return (
    <Screen
      footer={
        phase === 'done' ? (
          <Button label="Continue" onPress={() => navigation.navigate('CreatePin')} testID="setup-continue" />
        ) : phase === 'failed' ? (
          <Button label="Try again" onPress={run} testID="setup-retry" />
        ) : (
          <Button label="Setting up" busy onPress={() => undefined} />
        )
      }>
      <View style={styles.head}>
        <Text style={type.title} accessibilityRole="header">
          Setting up your wallet
        </Text>
        <Text style={type.body}>This needs signal once. After that you can pay without it.</Text>
      </View>

      <View style={{ gap: space(3) }}>
        {ORDER.map((step, i) => {
          const s = steps[step];
          const state = s?.state ?? 'waiting';
          return (
            <View key={step} style={styles.step} testID={`step-${step}-${state}`}>
              <StepMark n={i + 1} state={state} />
              <View style={{ flex: 1, gap: 4, paddingTop: 4 }}>
                <Text style={type.label}>{state === 'active' || state === 'waiting' ? TITLES[step].doing : state === 'done' ? TITLES[step].title : TITLES[step].doing}</Text>
                {s?.message ? <Text style={[type.small, state === 'failed' ? { color: colors.red } : null]}>{s.message}</Text> : null}
              </View>
            </View>
          );
        })}
      </View>

      <Card tone="mint">
        <Text style={[type.label, { color: colors.deep }]}>Starting limits for this phone</Text>
        <Line label="Each payment" value={`up to ${usdShort(limits.perPaymentCap)}`} />
        <Line label="Each day" value={`up to ${usdShort(limits.dailyCap)}`} />
        <Line label="Renews" value="in 7 days" />
        <Text style={[type.small, { color: colors.body }]}>If this phone is lost, nobody can spend more than this. You can change it any time.</Text>
      </Card>
    </Screen>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.line}>
      <Text style={[type.body, { fontSize: 15 }]}>{label}</Text>
      <Text style={[type.label]}>{value}</Text>
    </View>
  );
}

function StepMark({ n, state }: { n: number; state: string }) {
  if (state === 'done')
    return (
      <View style={[styles.mark, { backgroundColor: colors.green }]}>
        <Icon name="check" size={18} color="#FFFFFF" width={2.6} />
      </View>
    );
  if (state === 'active')
    return (
      <View style={styles.mark}>
        <ActivityIndicator color={colors.green} />
      </View>
    );
  if (state === 'failed' || state === 'skipped')
    return (
      <View style={[styles.mark, { backgroundColor: state === 'failed' ? colors.redSoft : colors.amberSoft }]}>
        <Icon name="alert" size={18} color={state === 'failed' ? colors.red : colors.amberText} />
      </View>
    );
  return (
    <View style={[styles.mark, styles.markWaiting]}>
      <Text style={{ fontFamily: fonts.semibold, fontSize: 14, color: colors.muted }}>{n}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { gap: space(2.5), paddingTop: space(6) },
  step: { backgroundColor: colors.card, borderRadius: 18, padding: 16, flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  mark: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  markWaiting: { borderWidth: 2, borderColor: '#CFCBBE' },
  line: { flexDirection: 'row', justifyContent: 'space-between' },
});
