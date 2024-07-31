# insert-refs-promise-loader

小程序分包异步化获取不到$refs解决方案


## Installation

```sh
npm install insert-refs-promise-loader --save-dev
```
## Usage
```js
module.exports = {
  module: {
    rules: [
      {
        test: /\.vue$/,
        use: [
          'insert-refs-promise-loader',
          //subPacks 异步分包的文件 pages 使用异步组件的文件  
           options:{
                // pages:[path.resolve(__dirname, "src/pages/SQGJ")],
                // subPacks:[path.resolve(__dirname, "src/pages/SQGJ")],
            }
        ]
      }
    ]
  }
};
```

