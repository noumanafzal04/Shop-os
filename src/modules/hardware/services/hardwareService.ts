import { apiDelete, apiGet, apiPost, apiPut } from "../../../common/api/client";

export type HardwareType =
  | "receipt_printer"
  | "label_printer"
  | "barcode_scanner"
  | "cash_drawer"
  | "customer_display";

export type ConnectionType = "browser" | "serial" | "usb" | "bluetooth" | "lan" | "wifi" | "native";

export interface HardwareDeviceSettings {
  paper_size?: "58mm" | "80mm" | "a4" | null;
  copies?: number | null;
  cut_paper?: boolean | null;
  open_drawer?: boolean | null;
}

export interface HardwareDevice {
  id: string;
  type: HardwareType;
  name: string;
  brand: string | null;
  model: string | null;
  connection_type: ConnectionType;
  connection_value: string | null;
  is_default: boolean;
  is_active: boolean;
  settings: HardwareDeviceSettings | null;
}

export interface HardwareDeviceInput {
  type?: HardwareType;
  name: string;
  brand?: string | null;
  model?: string | null;
  connection_type: ConnectionType;
  connection_value?: string | null;
  is_default?: boolean;
  is_active?: boolean;
  settings?: HardwareDeviceSettings | null;
}

export const hardwareService = {
  list: () => apiGet<HardwareDevice[]>("/hardware-devices"),
  create: (payload: HardwareDeviceInput) => apiPost<HardwareDevice>("/hardware-devices", payload),
  update: (id: string, payload: Partial<HardwareDeviceInput>) => apiPut<HardwareDevice>(`/hardware-devices/${id}`, payload),
  remove: (id: string) => apiDelete<null>(`/hardware-devices/${id}`),
};
