const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");

module.exports = {
  entry: "./src/index.ts",
  output: {
    filename: "[name].[contenthash].js",
    path: path.resolve(__dirname, "dist"),
  },
  mode: "development",
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: "ts-loader",
        exclude: /node_modules/,
      },
      {
        test: /\.(vert|frag)$/,
        use: "raw-loader",
      },
    ],
  },
  resolve: {
    extensions: [".tsx", ".ts", ".js"],
  },
  devtool: "source-map",
  devServer: {
    static: {
      directory: path.join(__dirname, "."),
    },
    compress: true,
    port: 9000,
  },
  plugins: [
    new CopyWebpackPlugin({
      patterns: [{ from: "styles.css" }, { from: "img/*", to: "img/[name][ext]" }],
    }),
    new HtmlWebpackPlugin({
      title: "Custom template",
      template: "index.html",
      hash: true,
      inject: "body",
    }),
  ],
};
