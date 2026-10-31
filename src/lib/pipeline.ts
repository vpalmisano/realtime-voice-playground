import debug from 'debug';
import { BaseProvider } from './providers/base';

const log = debug('realtime:pipeline');

export class PipelineSession extends BaseProvider {
  private readonly stt: BaseProvider;
  private readonly llm: BaseProvider;
  private readonly tts: BaseProvider;

  constructor(stt: BaseProvider, llm: BaseProvider, tts: BaseProvider) {
    super();
    this.stt = stt;
    this.llm = llm;
    this.tts = tts;
  }

  async start() {
    if (this.running) {
      return;
    }
    this.running = true;
    log('start');
    try {
      await Promise.all([this.stt.start(), this.llm.start(), this.tts.start()]);
      this.sourceAudioTrack = this.stt.sourceAudioTrack;
      this.outputAudioTrack = this.tts.outputAudioTrack;
      this.stt.on('text', text => {
        this.marker(Date.now(), 'lightgrey', 'STT text received');
        this.tts.flush();
        this.llm.sendMessage(text);
      });
      this.llm.on('text', text => {
        this.marker(Date.now(), 'lightgrey', 'LLM text received');
        this.tts.sendMessage(text);
      });
    } catch (error) {
      log('error starting pipeline: %o', error);
      await this.stop();
      throw error;
    }
  }

  sendMessage(message: string) {
    this.llm.sendMessage(message);
  }

  closeSession() {
    log('closeSession');
    void Promise.allSettled([this.stt.stop(), this.llm.stop(), this.tts.stop()]);
  }
}
