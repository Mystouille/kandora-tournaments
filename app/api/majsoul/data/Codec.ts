import type { Method, Root, Type } from "protobufjs";
import { MessageType } from "./types/enums/MessageType";

export class Codec {
  public static decodePaipuId(paipu: string): string {
    let e = "";
    for (
      let i = "0".charCodeAt(0), n = "a".charCodeAt(0), a = 0;
      a < paipu.length;
      a++
    ) {
      let o = -1;
      const r = paipu.charAt(a),
        s = r.charCodeAt(0);
      (s >= i && s < i + 10
        ? (o = s - i)
        : s >= n && s < n + 26 && (o = s - n + 10),
        (e +=
          -1 != o
            ? (o = (o + 55 - a) % 36) < 10
              ? String.fromCharCode(o + i)
              : String.fromCharCode(o + n - 10)
            : r));
    }
    return e;
  }

  public static stripMessageType(data: Buffer): {
    type: MessageType;
    data: Buffer;
  } {
    return {
      type: data[0],
      data: data.slice(1),
    };
  }

  public static addMessageType(type: MessageType, data: Uint8Array): Buffer {
    return Buffer.concat([Buffer.from([type]), data]);
  }

  public static stripIndex(data: Buffer): {
    index: number;
    data: Buffer;
  } {
    return {
      index: data[0] | (data[1] << 8),
      data: data.slice(2),
    };
  }

  public static addIndex(index: number, data: Uint8Array): Buffer {
    return Buffer.concat([Buffer.from([index & 0xff, index >> 8]), data]);
  }

  public static decode(
    root: InstanceType<typeof Root>,
    wrapper: InstanceType<typeof Type>,
    data: Buffer
  ): any {
    const message = wrapper.decode(data);
    const name = (message as any)["name"] as string | undefined;
    if (!name) {
      throw new Error(
        "Codec.decode: wrapped message has no `name` field; " +
          "cannot resolve concrete protobuf type."
      );
    }
    // `lookupType` throws on miss in modern protobufjs, but some
    // versions hand back `null` instead — either way the caller
    // would otherwise see an opaque "type.decode is not a function"
    // when Majsoul ships a record type our `liqi.json` doesn't yet
    // know about. Surface the offending name so the upstream log
    // can tell us which schema entry to add.
    const type = root.lookupType(name);
    if (!type || typeof type.decode !== "function") {
      throw new Error(
        `Codec.decode: unknown protobuf type "${name}" — ` +
          "liqi.json is likely out of date."
      );
    }
    return type.decode((message as any)["data"]);
  }

  private readonly wrapper: InstanceType<typeof Type>;

  constructor(private readonly protobufRoot: InstanceType<typeof Root>) {
    this.wrapper = protobufRoot.lookupType("Wrapper");
  }

  public decode<T = any>(data: Buffer): T {
    return Codec.decode(this.protobufRoot, this.wrapper, data);
  }

  public decodeMessage(
    message: Buffer,
    methodName?: string
  ): {
    type: MessageType;
    index?: number;
    data: any;
  } {
    const { type, data: wrappedData } = Codec.stripMessageType(message);
    if (type === MessageType.Notification) {
      return {
        type,
        data: this.decode(wrappedData),
      };
    }
    if (type !== MessageType.Response && type !== MessageType.Request) {
      console.log(`Unknown Message Type ${type}`);
      throw new Error(`Unknown Message Type ${type}`);
    }
    const { index, data } = Codec.stripIndex(wrappedData);
    const unwrappedMessage = this.wrapper.decode(data);
    const method = this.lookupMethod(
      methodName || (unwrappedMessage as any)["name"]
    );
    return {
      type,
      index,
      data: this.protobufRoot
        .lookupType(
          type === MessageType.Response
            ? method.requestType
            : method.requestType
        )
        .decode((unwrappedMessage as any)["data"]),
    };
  }

  private lookupMethod(path: string): InstanceType<typeof Method> {
    const sections = path.split(".");
    const service = this.protobufRoot.lookupService(sections.slice(0, -1));
    const name = sections[sections.length - 1];
    return service.methods[name];
  }
}
