import { ApplicationEmoji, Collection, type Snowflake } from "discord.js";

export class AppEmojiCollection {
  private static readonly GLOBAL_KEY = "__AppEmojiCollection__";

  private emojiCollection: Collection<Snowflake, ApplicationEmoji> | undefined;

  private constructor() {}

  /**
   * The static getter that controls access to the singleton instance.
   *
   * This implementation allows you to extend the Singleton class while
   * keeping just one instance of each subclass around.
   */
  public static get instance(): AppEmojiCollection {
    if (!(globalThis as any)[AppEmojiCollection.GLOBAL_KEY]) {
      (globalThis as any)[AppEmojiCollection.GLOBAL_KEY] =
        new AppEmojiCollection();
    }
    return (globalThis as any)[AppEmojiCollection.GLOBAL_KEY];
  }

  public setCollection(collection: Collection<Snowflake, ApplicationEmoji>) {
    this.emojiCollection = collection;
  }
  public getCollection(): Collection<Snowflake, ApplicationEmoji> {
    return this.emojiCollection!;
  }
}

export enum AppEmojiName {
  Chii = "chii",
  Pon = "pon",
  Kan = "kan",
  Skip = "skip",
  Riichi = "riichi",
  Eyes = "👀",
  m0 = "0m",
  m1 = "1m",
  m2 = "2m",
  m3 = "3m",
  m4 = "4m",
  m5 = "5m",
  m6 = "6m",
  m7 = "7m",
  m8 = "8m",
  m9 = "9m",
  p0 = "0p",
  p1 = "1p",
  p2 = "2p",
  p3 = "3p",
  p4 = "4p",
  p5 = "5p",
  p6 = "6p",
  p7 = "7p",
  p8 = "8p",
  p9 = "9p",
  s0 = "0s",
  s1 = "1s",
  s2 = "2s",
  s3 = "3s",
  s4 = "4s",
  s5 = "5s",
  s6 = "6s",
  s7 = "7s",
  s8 = "8s",
  s9 = "9s",
  z0 = "0z",
  z1 = "1z",
  z2 = "2z",
  z3 = "3z",
  z4 = "4z",
  z5 = "5z",
  z6 = "6z",
  z7 = "7z",
}

export function getEmojiByName(name: AppEmojiName): string {
  const e = AppEmojiCollection.instance
    .getCollection()
    ?.find((e) => e.name === name);
  return `<:${e!.name}:${e!.id}>`;
}
