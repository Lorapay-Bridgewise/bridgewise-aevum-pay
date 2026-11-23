import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEngine } from '../app/engine';
import type { RootStack, Tabs } from '../app/navigation';
import { findByName } from '../payments/engine';
import { registeredName, useApp } from '../state/store';
import { Icon } from '../ui/icons';
import { Avatar, Button, Chip, Notice, Screen } from '../ui/kit';
import { whenText } from '../ui/paymentView';
import { colors, fonts, radius, space, type } from '../ui/theme';

type Props = CompositeScreenProps<BottomTabScreenProps<Tabs, 'Contacts'>, NativeStackScreenProps<RootStack>>;

export function ContactsScreen({ navigation }: Props) {
  const engine = useEngine();
  const contacts = useApp(s => s.contacts);
  const names = useApp(s => s.names);
  const online = useApp(s => s.online);
  const hasRegistry = useApp(s => !!s.registry);
  const [q, setQ] = useState('');
  const [finding, setFinding] = useState(false);
  const [notFound, setNotFound] = useState('');

  async function find() {
    setFinding(true);
    setNotFound('');
    const r = await findByName(engine.deps, q).catch(() => null);
    setFinding(false);
    if (r) navigation.navigate('Amount', { address: r.address, name: r.name });
    else setNotFound(`Nobody has registered "${q.trim()}".`);
  }
  const shown = [...contacts]
    .filter(c => c.name.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Screen gap={16} testID="contacts">
      <View style={styles.head}>
        <Text style={type.title} accessibilityRole="header">
          Contacts
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Add a contact" onPress={() => navigation.navigate('AddContact')} style={styles.add} testID="add-contact">
          <Icon name="plus" size={18} color="#FFFFFF" width={2.4} />
          <Text style={{ fontFamily: fonts.semibold, fontSize: 15, color: '#FFFFFF' }}>Add</Text>
        </Pressable>
      </View>

      {contacts.length > 0 || hasRegistry ? (
        <View style={styles.search}>
          <Icon name="search" size={18} color={colors.muted} />
           <TextInput value={q} onChangeText={t => { setQ(t); setNotFound(''); }} placeholder="Search by name" placeholderTextColor={colors.faint} accessibilityLabel="Search contacts" style={styles.searchInput} />
        </View>
      ) : null}

      {hasRegistry && online && q.trim().length >= 3 ? (
        <Button label={`Find "${q.trim()}" in registered names`} kind="secondary" icon="shieldCheck" busy={finding} onPress={find} testID="find-registered" />
      ) : null}
      {notFound ? <Notice text={notFound} /> : null}

      {contacts.length === 0 ? (
        <View style={styles.empty}>
          <Text style={type.label}>No contacts yet</Text>
          <Text style={type.small}>Scan someone's code to pay them, or add them here. People you pay are easy to pay again.</Text>
          <Button label="Scan a code" icon="scan" onPress={() => navigation.navigate('Scan')} />
        </View>
      ) : (
        <View style={styles.list}>
          {shown.map((c, i) => (
            <Pressable
              key={c.address}
              accessibilityRole="button"
              accessibilityLabel={`Pay ${c.name}`}
              onPress={() => navigation.navigate('Amount', { address: c.address, name: c.name })}
              onLongPress={() => navigation.navigate('AddContact', { address: c.address, name: c.name })}
              style={[styles.row, i < shown.length - 1 ? styles.rowLine : null]}>
              <Avatar name={c.name} />
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={type.label}>{c.name}</Text>
                {registeredName(names, c.address) ? (
                  <Chip text={registeredName(names, c.address) === c.name ? 'Registered name' : `Registered as ${registeredName(names, c.address)}`} tone="green" icon="shieldCheck" />
                ) : (
                  <Text style={type.small}>{c.lastPaidAt ? `Last paid ${whenText(c.lastPaidAt).toLowerCase()}` : 'Not paid yet'}</Text>
                )}
              </View>
              <Icon name="chevron" size={18} color={colors.faint} width={2.2} />
            </Pressable>
          ))}
          {shown.length === 0 ? <Text style={[type.small, { padding: 16 }]}>Nobody by that name.</Text> : null}
        </View>
      )}

      <Text style={type.small}>
        A green mark means the name is registered to that wallet on the network. Other names are saved on this phone only, so check them with the person. Press and hold a contact to change it.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  add: { backgroundColor: colors.green, borderRadius: radius.pill, height: 44, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 6 },
  search: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 14, height: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 16, color: colors.ink, padding: 0 },
  list: { backgroundColor: colors.card, borderRadius: radius.lg, paddingVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16 },
  rowLine: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  empty: { backgroundColor: colors.card, borderRadius: radius.lg, padding: space(5), gap: space(3) },
});
