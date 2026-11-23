import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEngine } from '../app/engine';
import type { RootStack } from '../app/navigation';
import { usdShort } from '../core/money';
import { changeLimits, proposeLimits, spendable, type Proposal } from '../payments/engine';
import { Button, Card, Field, Notice, Screen, TopBar } from '../ui/kit';
import { colors, fonts, radius, space, type } from '../ui/theme';

type Props = NativeStackScreenProps<RootStack, 'Limits'>;

const D = 1_000_000n;
const PER = [2n, 5n, 10n, 20n].map(x => x * D);
const DAY = [5n, 10n, 20n, 50n].map(x => x * D);
const DAYS = [3, 7, 14, 30];

export function LimitsScreen({ navigation }: Props) {
  const engine = useEngine();
  const left = spendable();
  const [per, setPer] = useState(left?.perPaymentCap && PER.includes(left.perPaymentCap) ? left.perPaymentCap : 5n * D);
  const [day, setDay] = useState(10n * D);
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const bad = day < per;
  const [words, setWords] = useState('');
  const [asking, setAsking] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [question, setQuestion] = useState('');

  async function ask() {
    setAsking(true);
    setProposal(null);
    setQuestion('');
    const r = await proposeLimits(engine.deps, words).catch(() => ({ question: 'That needs signal. Please try again.' }));
    setAsking(false);
    if ('question' in r) setQuestion(r.question);
    else setProposal(r);
  }

  async function save(chosen = { perPaymentCap: per, dailyCap: day, expiresAt: BigInt(Math.floor(Date.now() / 1000) + days * 86_400) }) {
    setBusy(true);
    setError('');
    const r = await changeLimits(engine.deps, chosen).catch(() => ({
      ok: false,
      message: 'That needs signal. Please try again.',
    }));
    setBusy(false);
    if (r.ok) navigation.goBack();
    else setError(r.message ?? 'That did not work.');
  }

  return (
    <Screen
      header={<TopBar title="Offline limits" onBack={() => navigation.goBack()} />}
      footer={<Button label="Save limits" busy={busy} disabled={bad} onPress={() => save()} testID="save-limits" />}>
      <Text style={type.body}>If this phone is lost or stolen, nobody can spend more than these limits without signal.</Text>

      <Card tone="mint">
        <Field
          label="Say it in your own words"
          value={words}
          onChangeText={setWords}
          placeholder="$10 a day this week, nothing over $3 at once"
          maxLength={300}
          testID="allowance-words"
        />
        <Button label="Suggest limits" kind="secondary" busy={asking} disabled={words.trim().length < 3} onPress={ask} testID="allowance-ask" />
        {question ? <Text style={[type.body, { fontSize: 15 }]}>{question}</Text> : null}
        {proposal ? (
          <View style={{ gap: space(2) }} testID="allowance-proposal">
            <Text style={type.label}>{proposal.summary}</Text>
            <Text style={type.small}>
              {proposal.source === 'claude' ? 'Suggested by the allowance agent (Claude).' : 'Suggested by the allowance agent.'} Nothing changes until you approve it with your
              fingerprint, and the vault enforces it.
            </Text>
            <Button label="Use these limits" busy={busy} onPress={() => save(proposal.limits)} testID="allowance-use" />
          </View>
        ) : null}
      </Card>

      <Text style={type.label}>Or choose</Text>
      <Choice title="Each payment, up to" options={PER.map(v => ({ key: String(v), label: usdShort(v), on: v === per, pick: () => setPer(v) }))} />
      <Choice title="Each day, up to" options={DAY.map(v => ({ key: String(v), label: usdShort(v), on: v === day, pick: () => setDay(v) }))} />
      <Choice title="Renew after" options={DAYS.map(v => ({ key: String(v), label: `${v} days`, on: v === days, pick: () => setDays(v) }))} />
      {bad ? <Notice tone="red" text="The daily limit must be at least the payment limit." /> : null}
      {error ? <Notice tone="red" text={error} /> : null}
      <Text style={type.small}>Saving asks for your fingerprint or screen lock, and needs signal.</Text>
    </Screen>
  );
}

function Choice({ title, options }: { title: string; options: { key: string; label: string; on: boolean; pick: () => void }[] }) {
  return (
    <View style={{ gap: space(2) }}>
      <Text style={type.label}>{title}</Text>
      <View style={styles.options}>
        {options.map(o => (
          <Pressable
            key={o.key}
            accessibilityRole="radio"
            accessibilityState={{ selected: o.on }}
            onPress={o.pick}
            style={[styles.option, o.on ? styles.on : null]}>
            <Text style={{ fontFamily: fonts.semibold, fontSize: 15, color: o.on ? '#FFFFFF' : colors.ink }}>{o.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  options: { flexDirection: 'row', gap: 8 },
  option: { flex: 1, height: 48, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  on: { backgroundColor: colors.green, borderColor: colors.green },
});
