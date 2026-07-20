# Naver Maps への切り替え手順（将来対応）

ベータ版の地図は、APIキー不要のLeaflet + 明るいベースマップ（CartoDB Positron）で動いています。
韓国国内の道路・POI情報はGoogle Mapsより Naver Mapsの方が圧倒的に詳しいため、本格運用する際は
Naver MapsのJavaScript SDKに差し替えることをおすすめします。

## 1. Naver Cloud Platformアカウントを作る

1. https://www.ncloud.com/ にアクセスし、アカウントを作成（メールアドレスでの登録が可能）
2. コンソールにログイン後、「AI・Application Service」→「Maps」を選択
3. 「Application」を新規登録し、利用するAPI(Web Dynamic Map / Geocoding など)にチェック
4. 登録したApplicationの「認証情報」タブに表示される **Client ID** を控える
5. 「Web サービス URL」欄に、実際にアプリを公開するドメイン(例: `https://your-username.github.io`)を登録する
   (未登録のドメインからのリクエストはブロックされます)

無料枠の範囲内であれば個人のベータ利用で費用は発生しませんが、利用量の上限は都度NCPコンソールで確認してください。

## 2. コードの差し替え箇所

- `js/map-provider.js` に `LeafletMapProvider` と同じメソッド(`init`, `setMarkers`, `panTo`, `invalidateSize`)
  を持つ `NaverMapProvider` クラスを追加します。
- `index.html` の Leaflet の `<script>` タグを、Naver Maps SDKの読み込みタグに置き換えます:
  ```html
  <script src="https://oapi.map.naver.com/openapi/v3/maps.js?ncpClientId=YOUR_CLIENT_ID"></script>
  ```
- `js/app.js` の `mapProvider = new LeafletMapProvider("map")` を `new NaverMapProvider("map")` に変更します。

## 3. コネスト地図のような「見せたい情報だけ目立たせる」スタイル

Naver Maps JS SDK は `NMap.Style` や `mapTypeId` に加えて、NCPコンソールの「Style Editor」で
道路・地下鉄路線・主要施設ラベルの太さや表示優先度をカスタマイズできます。以下を目安に:
- 地下鉄路線・駅名: 太く、常に表示
- 主要観光地・ランドマーク: 中程度の強調
- その他の一般POI: 非表示 or 最小限

## 4. ジオコーディングの精度向上

ベータ版の座標は無料のNominatim(OpenStreetMap)で取得しています(`js/data.js`の`geo_precision`が
`road_address`以外の項目は特に精度が落ちます)。Naver Geocoding APIのキーが手に入ったら、同じ住所を
再ジオコーディングして`js/data.js`の`lat`/`lon`を更新すると、より正確な位置になります。
