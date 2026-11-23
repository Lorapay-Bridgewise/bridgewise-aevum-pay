import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStack } from '../app/navigation';
import { Icon } from '../ui/icons';
import { Button, Screen } from '../ui/kit';
import { colors, fonts, radius, space, type } from '../ui/theme';

type Props = NativeStackScreenProps<RootStack, 'Welcome'>;

export function WelcomeScreen({ navigation }: Props) {
  return (
    <Screen scroll={false} gap={28} footer={<Button label="Get started" onPress={() => navigation.navigate('Setup')} testID="get-started" />}>
      <View style={styles.brand}>
        <View style={styles.logo}>
          <Icon name="send" size={18} color="#FFFFFF" width={2.4} />
        </View>
        <Text style={styles.brandText}>Aevum Pay</Text>
      </View>

      <View style={styles.art} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={styles.phone}>
          <Icon name="noSignal" size={26} color="#F3C27A" />
          <Text style={styles.phoneText}>You</Text>
        </View>
        <View style={styles.hops}>
          {[0, 1, 2].map(i => (
            <View key={i} style={styles.hop} />
          ))}
        </View>
        <View style={styles.phone}>
          <Icon name="signal" size={26} color="#6FCF97" />
          <Text style={styles.phoneText}>Nearby phone</Text>
        </View>
      </View>

      <View style={{ gap: space(3) }}>
        <Text style={type.hero} accessibilityRole="header">
          Pay even when there is no signal.
        </Text>
        <Text style={type.body}>Your phone signs the payment. Phones nearby pass it along until one has signal, then the money moves.</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: { width: 32, height: 32, borderRadius: 10, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  brandText: { fontFamily: fonts.display, fontSize: 20, color: colors.ink },
  art: { flex: 1, minHeight: 200, backgroundColor: colors.deep, borderRadius: radius.sheet, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 18, padding: 24 },
  phone: { width: 78, height: 140, borderRadius: 16, borderWidth: 3, borderColor: colors.onDeepMuted, alignItems: 'center', justifyContent: 'center', gap: 8 },
  phoneText: { fontFamily: fonts.regular, fontSize: 12, color: colors.onDeepMuted, textAlign: 'center' },
  hops: { flexDirection: 'row', gap: 6 },
  hop: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#6FCF97' },
});
