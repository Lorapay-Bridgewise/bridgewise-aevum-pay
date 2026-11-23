import React, { useState } from 'react';
import { Alert, Text } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStack } from '../app/navigation';
import { parsePayCode } from '../core/qr';
import { contactFor, useApp } from '../state/store';
import { Button, Field, Screen, TopBar } from '../ui/kit';
import { type } from '../ui/theme';

type Props = NativeStackScreenProps<RootStack, 'AddContact'>;

export function AddContactScreen({ navigation, route }: Props) {
  const given = route.params ?? {};
  const existing = given.address ? contactFor(useApp.getState().contacts, given.address) : undefined;
  const [name, setName] = useState(existing?.name ?? given.name ?? '');
  const [address, setAddress] = useState(given.address ?? '');
  const [tried, setTried] = useState(false);
  const code = parsePayCode(address);
  const own = useApp(s => s.owner)?.toLowerCase() === code?.address.toLowerCase();

  function save() {
    setTried(true);
    if (!code || !name.trim() || own) return;
    useApp.getState().saveContact({ address: code.address, name });
    navigation.goBack();
  }

  return (
    <Screen
      header={<TopBar title={existing ? 'Change contact' : 'Add a contact'} onBack={() => navigation.goBack()} />}
      footer={
        <>
          <Button label="Save" onPress={save} testID="save-contact" />
          {existing ? (
            <Button
              label="Remove contact"
              kind="danger"
              onPress={() =>
                Alert.alert('Remove contact?', `${existing.name} will be removed from this phone.`, [
                  { text: 'Keep', style: 'cancel' },
                  { text: 'Remove', style: 'destructive', onPress: () => { useApp.getState().removeContact(existing.address); navigation.goBack(); } },
                ])
              }
            />
          ) : null}
        </>
      }>
      <Field label="Name" value={name} onChangeText={setName} placeholder="For example, Musa's Kiosk" maxLength={40} error={tried && !name.trim() ? 'Enter a name.' : undefined} testID="contact-name" />
      {existing ? null : (
        <>
          <Field
            label="Wallet address"
            value={address}
            onChangeText={t => {
              const c = parsePayCode(t);
              setAddress(c ? c.address : t);
              if (c?.name && !name) setName(c.name);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="0x…"
            error={tried && !code ? 'That is not a wallet address.' : own ? 'That is your own wallet.' : undefined}
            testID="contact-address"
          />
          <Button
            label="Paste"
            kind="secondary"
            onPress={async () => {
              const t = await Clipboard.getString();
              const c = parsePayCode(t);
              setAddress(c ? c.address : t.trim());
              if (c?.name && !name) setName(c.name);
            }}
          />
          <Text style={type.small}>Easier: ask them to open Receive in Aevum Pay, then scan their code from Home.</Text>
        </>
      )}
    </Screen>
  );
}
