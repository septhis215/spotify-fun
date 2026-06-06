import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SpotifyModule } from './spotify/spotify.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), SpotifyModule],
})
export class AppModule {}
