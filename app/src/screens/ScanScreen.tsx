import React, { useEffect, useRef, useState } from 'react';
import { Linking, PermissionsAndroid, Platform, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { Camera, CameraType } from 'react-native-camera-kit';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStack } from '../app/navigation';
import { parsePayCode, type PayCode } from '../core/qr';
import { useApp } from '../state/store';
import { Icon } from '../ui/icons';
import { Avatar, Button, Notice, TopBar } from '../ui/kit';
import { colors, fonts, space, type } from '../ui/theme';

type Props = NativeStackScreenProps<RootStack, 'Scan'>;
type CameraState = 'asking' | 'granted' | 'denied';

async function askCamera(): Promise<CameraState> {
  if (Platform.OS !== 'android') return 'granted';
  const has = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA);
  if (has) return 'granted';
  const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA, {
    title: 'Scan to pay',
    message: 'Aevum Pay uses the camera only to read payment codes.',
    buttonPositive: 'Allow',
  });
  return r === PermissionsAndroid.RESULTS.GRANTED ? 'granted' : 'denied';
}

export function ScanScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const contacts = useApp(s => s.contacts);
  const [camera, setCamera] = useState<CameraState>('asking');
  const [torch, setTorch] = useState(false);
  const [problem, setProblem] = useState('');
  const done = useRef(false);

  useEffect(() => {
    askCamera().then(setCamera).catch(() => setCamera('denied'));
  }, []);

  function go(code: PayCode | null) {
    if (!code) {
      setProblem('That is not an Aevum Pay code or a wallet address.');
      return;
    }
    if (done.current) return;
    done.current = true;
    navigation.replace('Amount', { address: code.address, name: code.name, amount: code.amount?.toString() });
  }

  async function paste() {
    go(parsePayCode(await Clipboard.getString()));
  }

  const recent = [...contacts].sort((a, b) => (b.lastPaidAt ?? b.addedAt) - (a.lastPaidAt ?? a.addedAt)).slice(0, 4);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" />
      <TopBar
        title="Scan to pay"
        icon="close"
        dark
        onBack={() => navigation.goBack()}
        right={
          camera === 'granted' ? (
            <Pressable accessibilityRole="button" accessibilityLabel={torch ? 'Turn off torch' : 'Turn on torch'} onPress={() => setTorch(t => !t)} style={styles.round}>
              <Icon name="torch" size={20} color="#FFFFFF" />
            </Pressable>
          ) : undefined
        }
      />

      <View style={styles.view}>
        {camera === 'granted' ? (
          <>
            <Camera
              style={StyleSheet.absoluteFill}
              cameraType={CameraType.Back}
              scanBarcode
              allowedBarcodeTypes={['qr']}
              torchMode={torch ? 'on' : 'off'}
              onReadCode={e => go(parsePayCode(e.nativeEvent.codeStringValue))}
              testID="camera"
            />
            <Frame />
            <Text style={styles.hint}>Point the camera at the other person's Aevum Pay code</Text>
          </>
        ) : camera === 'denied' ? (
          <View style={{ gap: space(4), padding: space(6) }}>
            <Text style={[styles.hint, { marginTop: 0 }]}>To scan codes, allow Aevum Pay to use the camera.</Text>
            <Button label="Open settings" kind="light" onPress={() => Linking.openSettings()} />
          </View>
        ) : null}
      </View>

      <View style={[styles.sheet, { paddingBottom: insets.bottom + space(6) }]}>
        <View style={styles.grip} />
        {problem ? <Notice text={problem} tone="red" /> : null}
        {recent.length ? (
          <>
            <Text style={type.label}>Or pay someone you have paid before</Text>
            <View style={styles.people}>
              {recent.map(c => (
                <Pressable key={c.address} accessibilityRole="button" accessibilityLabel={`Pay ${c.name}`} style={styles.person} onPress={() => go({ address: c.address, name: c.name })}>
                  <Avatar name={c.name} size={52} />
                  <Text style={styles.personName} numberOfLines={2}>
                    {c.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}
        <Button label="Paste a wallet address instead" kind="quiet" onPress={paste} testID="paste-address" />
      </View>
    </View>
  );
}

function Frame() {
  const c = { position: 'absolute' as const, width: 44, height: 44, borderColor: '#6FCF97' };
  return (
    <View style={styles.frame} pointerEvents="none">
      <View style={[c, { left: 0, top: 0, borderLeftWidth: 5, borderTopWidth: 5, borderTopLeftRadius: 18 }]} />
      <View style={[c, { right: 0, top: 0, borderRightWidth: 5, borderTopWidth: 5, borderTopRightRadius: 18 }]} />
      <View style={[c, { left: 0, bottom: 0, borderLeftWidth: 5, borderBottomWidth: 5, borderBottomLeftRadius: 18 }]} />
      <View style={[c, { right: 0, bottom: 0, borderRightWidth: 5, borderBottomWidth: 5, borderBottomRightRadius: 18 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.camera },
  round: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  view: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  frame: { width: 250, height: 250 },
  hint: { marginTop: 24, maxWidth: 260, textAlign: 'center', fontFamily: fonts.regular, fontSize: 16, lineHeight: 24, color: '#D5DDD8', backgroundColor: 'rgba(11,15,13,0.55)', borderRadius: 12, paddingHorizontal: 8 },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 20, paddingHorizontal: 20, gap: 16 },
  grip: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#CFCBBE', alignSelf: 'center' },
  people: { flexDirection: 'row', gap: 8 },
  person: { flex: 1, alignItems: 'center', gap: 6, padding: 4 },
  personName: { fontFamily: fonts.medium, fontSize: 13, color: colors.ink, textAlign: 'center' },
});
