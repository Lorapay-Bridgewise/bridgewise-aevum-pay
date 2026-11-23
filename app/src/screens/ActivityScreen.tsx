import React from 'react';
import { Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEngine } from '../app/engine';
import type { RootStack } from '../app/navigation';
import { useApp } from '../state/store';
import { makeFeed } from '../ui/feed';
import { Screen, TopBar } from '../ui/kit';
import { type } from '../ui/theme';
import { IncomingRow, PaymentRow } from './HomeScreen';

type Props = NativeStackScreenProps<RootStack, 'Activity'>;

export function ActivityScreen({ navigation }: Props) {
  const engine = useEngine();
  const payments = useApp(s => s.payments);
  const incoming = useApp(s => s.incoming);
  const feed = makeFeed(payments, incoming);
  return (
    <Screen gap={8} onRefresh={engine.refresh} header={<TopBar title="All payments" onBack={() => navigation.goBack()} />}>
      {feed.length === 0 ? <Text style={type.small}>No payments yet.</Text> : null}
      {feed.map(f =>
        f.out ? (
          <PaymentRow key={f.key} p={f.out} onPress={() => navigation.navigate('Payment', { id: f.out!.id })} />
        ) : (
          <IncomingRow key={f.key} i={f.in!} name={f.in!.fromName} explorer={engine.deps.cfg.explorerUrl} />
        ),
      )}
    </Screen>
  );
}
