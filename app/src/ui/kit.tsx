import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from './icons';
import { colors, fonts, radius, space, type } from './theme';

/** A full screen: safe area, optional scrolling and pull to refresh, and a footer pinned to the bottom. */
export function Screen({
  children,
  footer,
  header,
  onRefresh,
  scroll = true,
  dark,
  gap = 18,
  testID,
}: {
  children: React.ReactNode;
  footer?: React.ReactNode;
  header?: React.ReactNode;
  onRefresh?: () => Promise<unknown>;
  scroll?: boolean;
  dark?: boolean;
  gap?: number;
  testID?: string;
}) {
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = React.useState(false);
  const refresh = onRefresh ? (
    <RefreshControl
      refreshing={refreshing}
      tintColor={colors.green}
      colors={[colors.green]}
      onRefresh={async () => {
        setRefreshing(true);
        await onRefresh().catch(() => undefined);
        setRefreshing(false);
      }}
    />
  ) : undefined;
  const body = [styles.body, { gap }];
  return (
    <View testID={testID} style={[styles.screen, { paddingTop: insets.top, backgroundColor: dark ? colors.deep : colors.bg }]}>
      {header}
      {scroll ? (
        <ScrollView contentContainerStyle={body} keyboardShouldPersistTaps="handled" refreshControl={refresh}>
          {children}
        </ScrollView>
      ) : (
        <View style={[body, { flex: 1 }]}>{children}</View>
      )}
      {footer ? <View style={[styles.footer, { paddingBottom: insets.bottom + space(4) }]}>{footer}</View> : null}
    </View>
  );
}

/** Back or close button and a title, as on every inner screen. */
export function TopBar({ title, onBack, icon = 'back', dark, right }: { title?: string; onBack?: () => void; icon?: 'back' | 'close'; dark?: boolean; right?: React.ReactNode }) {
  return (
    <View style={styles.topBar}>
      {onBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={icon === 'close' ? 'Close' : 'Back'}
          onPress={onBack}
          hitSlop={8}
          style={[styles.round, { backgroundColor: dark ? 'rgba(255,255,255,0.14)' : colors.card }]}>
          <Icon name={icon} size={20} width={2.2} color={dark ? '#FFFFFF' : colors.ink} />
        </Pressable>
      ) : null}
      {title ? (
        <Text style={[type.h2, { color: dark ? '#FFFFFF' : colors.ink, flex: 1 }]} accessibilityRole="header">
          {title}
        </Text>
      ) : (
        <View style={{ flex: 1 }} />
      )}
      {right}
    </View>
  );
}

export function Card({ children, style, tone = 'white' }: { children: React.ReactNode; style?: ViewStyle; tone?: 'white' | 'mint' | 'deep' }) {
  const bg = tone === 'mint' ? colors.mint : tone === 'deep' ? colors.deep : colors.card;
  return <View style={[styles.card, { backgroundColor: bg }, style]}>{children}</View>;
}

type ButtonKind = 'primary' | 'secondary' | 'quiet' | 'danger' | 'light' | 'outlineLight';

export function Button({
  label,
  onPress,
  kind = 'primary',
  busy,
  disabled,
  icon,
  testID,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  kind?: ButtonKind;
  busy?: boolean;
  disabled?: boolean;
  icon?: IconName;
  testID?: string;
  accessibilityLabel?: string;
}) {
  const look = buttonLook[kind];
  const off = disabled || busy;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: look.bg, borderColor: look.border ?? look.bg, opacity: disabled ? 0.45 : pressed ? 0.85 : 1 },
        kind === 'quiet' && styles.quiet,
      ]}>
      {busy ? <ActivityIndicator color={look.fg} /> : icon ? <Icon name={icon} size={20} color={look.fg} /> : null}
      <Text style={[styles.buttonText, { color: look.fg }]}>{label}</Text>
    </Pressable>
  );
}

const buttonLook: Record<ButtonKind, { bg: string; fg: string; border?: string }> = {
  primary: { bg: colors.green, fg: '#FFFFFF' },
  secondary: { bg: colors.card, fg: colors.ink, border: colors.line },
  quiet: { bg: 'transparent', fg: colors.green },
  danger: { bg: 'transparent', fg: colors.red },
  light: { bg: '#FFFFFF', fg: colors.deep },
  outlineLight: { bg: 'transparent', fg: '#FFFFFF', border: 'rgba(255,255,255,0.4)' },
};

/** Small rounded status label: on its way (amber), paid (green), failed (red), info. */
export function Chip({ text, tone, icon }: { text: string; tone: 'amber' | 'green' | 'red' | 'grey'; icon?: IconName }) {
  const c = chipLook[tone];
  return (
    <View style={[styles.chip, { backgroundColor: c.bg }]}>
      {icon ? <Icon name={icon} size={15} color={c.fg} /> : null}
      <Text style={[styles.chipText, { color: c.fg }]}>{text}</Text>
    </View>
  );
}

const chipLook = {
  amber: { bg: colors.amberSoft, fg: colors.amberText },
  green: { bg: colors.paidSoft, fg: colors.greenDark },
  red: { bg: colors.redSoft, fg: colors.red },
  grey: { bg: colors.lineSoft, fg: colors.muted },
};

/** First letter of a name in a circle. */
export function Avatar({ name, size = 44, dark }: { name: string; size?: number; dark?: boolean }) {
  const letter = (name.trim()[0] ?? '?').toUpperCase();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: dark ? colors.deep : colors.mint, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontFamily: fonts.semibold, fontSize: size * 0.38, color: dark ? '#FFFFFF' : colors.deep }}>{letter}</Text>
    </View>
  );
}

/** Number pad for amounts (with a point) and PINs (without). */
export function Keypad({ onKey, point, keyHeight = 56, testID }: { onKey: (k: string) => void; point?: boolean; keyHeight?: number; testID?: string }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', point ? '.' : '', '0', 'back'];
  return (
    <View style={styles.pad} testID={testID}>
      {keys.map((k, i) =>
        k === '' ? (
          <View key={i} style={[styles.key, { height: keyHeight, backgroundColor: 'transparent' }]} />
        ) : (
          <Pressable
            key={i}
            testID={`key-${k}`}
            accessibilityRole="button"
            accessibilityLabel={k === 'back' ? 'Delete' : k === '.' ? 'Point' : k}
            onPress={() => onKey(k)}
            style={({ pressed }) => [styles.key, { height: keyHeight, opacity: pressed ? 0.6 : 1 }]}>
            {k === 'back' ? <Icon name="back" size={24} /> : <Text style={styles.keyText}>{k}</Text>}
          </Pressable>
        ),
      )}
    </View>
  );
}

export function PinDots({ length, filled }: { length: number; filled: number }) {
  return (
    <View style={styles.dots} accessibilityLabel={`${filled} of ${length} digits entered`} accessible>
      {Array.from({ length }, (_, i) => (
        <View key={i} style={[styles.dot, i < filled ? styles.dotOn : styles.dotOff]} />
      ))}
    </View>
  );
}

export function Field({ label, hint, error, ...input }: TextInputProps & { label: string; hint?: string; error?: string }) {
  return (
    <View style={{ gap: space(1.5) }}>
      <Text style={type.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.faint}
        style={[styles.input, error ? { borderColor: colors.red } : null]}
        {...input}
      />
      {error ? <Text style={[type.small, { color: colors.red }]}>{error}</Text> : hint ? <Text style={type.small}>{hint}</Text> : null}
    </View>
  );
}

/** One line of a list: label on the left, value on the right. */
export function Row({ label, value, sub, strong, last }: { label: string; value: string; sub?: string; strong?: boolean; last?: boolean }) {
  return (
    <View style={[styles.row, last ? null : styles.rowLine]}>
      <Text style={[type.body, { color: strong ? colors.ink : colors.muted, fontFamily: strong ? fonts.semibold : fonts.regular }]}>{label}</Text>
      <View style={{ alignItems: 'flex-end', flexShrink: 1 }}>
        <Text style={strong ? [type.money, { fontSize: 20 }] : [type.label, { fontSize: 16 }]}>{value}</Text>
        {sub ? <Text style={[type.small, { fontFamily: fonts.semibold, color: colors.greenDark }]}>{sub}</Text> : null}
      </View>
    </View>
  );
}

/** A switch with its label and explanation. */
export function ToggleRow({ label, sub, value, onChange, last, disabled }: { label: string; sub?: string; value: boolean; onChange: (v: boolean) => void; last?: boolean; disabled?: boolean }) {
  return (
    <View style={[styles.toggle, last ? null : styles.rowLine]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={type.label}>{label}</Text>
        {sub ? <Text style={type.small}>{sub}</Text> : null}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ true: colors.green, false: colors.line }}
        thumbColor="#FFFFFF"
      />
    </View>
  );
}

/** A tappable row that opens something. */
export function LinkRow({ label, onPress, tone = 'ink', last, testID }: { label: string; onPress: () => void; tone?: 'ink' | 'red'; last?: boolean; testID?: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={[styles.toggle, last ? null : styles.rowLine]}>
      <Text style={[type.label, { flex: 1, color: tone === 'red' ? colors.red : colors.ink }]}>{label}</Text>
      {tone === 'ink' ? <Icon name="chevron" size={18} color={colors.faint} width={2.2} /> : null}
    </Pressable>
  );
}

export function Notice({ text, tone = 'amber', icon }: { text: string; tone?: 'amber' | 'red' | 'green'; icon?: IconName }) {
  const c = tone === 'red' ? { bg: colors.redSoft, fg: colors.red } : tone === 'green' ? { bg: colors.paidSoft, fg: colors.greenDark } : { bg: colors.amberSoft, fg: '#6B3A05' };
  return (
    <View style={[styles.notice, { backgroundColor: c.bg }]} accessibilityRole="alert">
      {icon ? <Icon name={icon} size={20} color={c.fg} /> : null}
      <Text style={[type.body, { fontSize: 14, lineHeight: 20, color: c.fg, flex: 1 }]}>{text}</Text>
    </View>
  );
}

export function SectionTitle({ children, right }: { children: string; right?: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={type.h2} accessibilityRole="header">
        {children}
      </Text>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { paddingHorizontal: space(5), paddingTop: space(5), paddingBottom: space(6) },
  footer: { paddingHorizontal: space(5), paddingTop: space(3), gap: space(2) },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: space(3), paddingHorizontal: space(5), paddingTop: space(4) },
  round: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: radius.lg, padding: space(4), gap: space(3) },
  button: { height: 56, borderRadius: radius.md, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space(2), paddingHorizontal: space(4) },
  quiet: { height: 44, borderWidth: 0 },
  buttonText: { fontFamily: fonts.semibold, fontSize: 17 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' },
  chipText: { fontFamily: fonts.semibold, fontSize: 12 },
  pad: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8 },
  key: { width: '31.8%', borderRadius: 14, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  keyText: { fontFamily: fonts.displayMedium, fontSize: 24, color: colors.ink },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 14 },
  dot: { width: 16, height: 16, borderRadius: 8 },
  dotOn: { backgroundColor: colors.deep },
  dotOff: { borderWidth: 2, borderColor: colors.faint },
  input: { height: 52, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card, paddingHorizontal: space(4), fontFamily: fonts.regular, fontSize: 16, color: colors.ink },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, gap: space(3) },
  rowLine: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: space(3), paddingVertical: 14, paddingHorizontal: space(4) },
  notice: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14 },
  section: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
});
