import React, { useState } from 'react';
import { Share, StatusBar, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import Clipboard from '@react-native-clipboard/clipboard';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStack } from '../app/navigation';
import { formatAmount, keypadInput, parseAmount, usd } from '../core/money';
import { encodePayCode } from '../core/qr';
import { registeredName, useApp } from '../state/store';
import { Avatar, Button, Chip, Keypad, Screen, TopBar } from '../ui/kit';
import { colors, radius, space, type } from '../ui/theme';

type Props = NativeStackScreenProps<RootStack, 'Receive'>;

export function ReceiveScreen({ navigation }: Props) {
  const { owner, name: localName } = useApp();
  const registered = useApp(s => (s.owner ? registeredName(s.names, s.owner) : undefined));
  const name = registered ?? localName;
  const [asking, setAsking] = useState(false);
  const [text, setText] = useState('');
  const [copied, setCopied] = useState(false);
  const amount = parseAmount(text);

  if (!owner) {
    return (
      <Screen header={<TopBar title="Receive money" onBack={() => navigation.goBack()} />}>
        <Text style={type.body}>Your wallet is still being created. Try again in a moment.</Text>
      </Screen>
    );
  }
  const code = encodePayCode({ address: owner, name, amount: asking ? amount : null }, formatAmount);

  if (asking) {
    return (
      <Screen
        scroll={false}
        header={<TopBar title="Ask for an amount" onBack={() => setAsking(false)} />}
        footer={<Button label="Show my code" disabled={!amount} onPress={() => setAsking(false)} testID="ask-done" />}>
        <View style={styles.amount}>
          <Text style={[type.money, { fontSize: 56 }]}>${text || '0'}</Text>
          <Text style={type.small}>The person paying sees this amount filled in.</Text>
        </View>
        <Keypad point onKey={k => setText(t => keypadInput(t, k))} />
      </Screen>
    );
  }

  return (
    <Screen dark header={<TopBar title="Receive money" dark onBack={() => navigation.goBack()} />} footer={null}>
      <StatusBar barStyle="light-content" />
      <View style={styles.card} testID="receive-card">
        <View style={styles.who}>
          <Avatar name={name || 'A'} size={40} dark />
          <View>
            <Text style={type.h2}>{name || 'Your wallet'}</Text>
            <Text style={type.small}>{amount && text ? `Asking for ${usd(amount)}` : 'Aevum Pay'}</Text>
          </View>
        </View>
        {registered ? <Chip text="Registered name" tone="green" icon="shieldCheck" /> : null}
        <View accessible accessibilityRole="image" accessibilityLabel="Your payment code">
          <QRCode value={code} size={230} color={colors.deep} backgroundColor="#FFFFFF" ecl="M" />
        </View>
        <Text style={[type.body, { fontSize: 15, textAlign: 'center' }]}>Show this to the person paying you. It works without signal.</Text>
      </View>

      <View style={styles.buttons}>
        <View style={{ flex: 1 }}>
          <Button label="Share" kind="light" icon="share" onPress={() => Share.share({ message: `Pay me with Aevum Pay: ${code}` }).catch(() => undefined)} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label={text ? 'Change amount' : 'Ask for an amount'} kind="outlineLight" onPress={() => setAsking(true)} testID="ask-amount" />
        </View>
      </View>
      <Button
        label={copied ? 'Address copied' : 'Copy wallet address'}
        kind="outlineLight"
        icon="copy"
        onPress={() => {
          Clipboard.setString(owner);
          setCopied(true);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#FFFFFF', borderRadius: radius.sheet, padding: 24, alignItems: 'center', gap: 16, marginTop: space(4) },
  who: { flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'center' },
  buttons: { flexDirection: 'row', gap: 12 },
  amount: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space(2) },
});
