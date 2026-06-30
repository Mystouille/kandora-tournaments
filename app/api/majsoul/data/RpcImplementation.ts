import protobuf from "protobufjs";
import type { Method, Root, Type } from "protobufjs";
import { Subscription } from "rxjs";
type RPCImplCallback = protobuf.RPCImplCallback;
import { Codec } from "./Codec";
import { MessageType } from "./types/enums/MessageType";
import { Connection } from "./Connection";
import { RpcService } from "./Service";

export class RpcImplementation {
  private readonly transactionMap: {
    [key: number]: RPCImplCallback;
  } = {};

  private readonly dataSubscription: Subscription;
  private readonly wrapper: InstanceType<typeof Type>;
  private index = 0;

  constructor(
    private readonly connection: Connection,
    private readonly protobufRoot: InstanceType<typeof Root>
  ) {
    this.wrapper = protobufRoot.lookupType("Wrapper");
    this.dataSubscription = connection.messages.subscribe((message) => {
      if (message.type !== MessageType.Response) {
        return;
      }
      const { index, data } = Codec.stripIndex(message.data);
      const callback = this.transactionMap[index];
      delete this.transactionMap[index];
      if (!callback) {
        return;
      }
      try {
        const message = (this.wrapper.decode(data) as any)["data"];
        callback(null, message);
      } catch (error) {
        callback(error as Error, null);
      }
    });
  }

  public getService(name: string): RpcService {
    return new RpcService(name, this.protobufRoot, (m, r, c) =>
      this.rpcCall(m as InstanceType<typeof Method>, r, c)
    );
  }

  private rpcCall(
    method: InstanceType<typeof Method>,
    requestData: Uint8Array,
    callback: RPCImplCallback
  ) {
    const index = this.index++ % 60007;
    this.transactionMap[index] = callback;
    this.connection.send(
      MessageType.Request,
      Codec.addIndex(
        index,
        this.wrapper
          .encode(
            this.wrapper.create({
              name: method.fullName,
              data: requestData,
            })
          )
          .finish()
      )
    );
  }
}
