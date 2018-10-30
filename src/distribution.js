"use strict";

// TODO: allow horizontally truncated distributions (i.e. cap minimum values at 0 to begin with)
// TODO: yInt adjustment?
// TODO: widget label style options

class Distribution {
    /**
     * @constructor
     *
     * Distribution allows the generation of probability distributions (using the normal distribution)
     * on the basis of a specified (x,y) coordinate giving the probability density at the mean
     * (the distribution is symmetrical).
     *
     * The distributions allow for a form of spread betting on a range of possible answers. The range of
     * widths (standard deviations) allowed can be specified using min/maxPrecision, and the distribution
     * is scaled to respect that value to avoid unnecessary whitespace.
     *
     * Betting values can be included. Betting values start with the minimum bet for the minimum precision
     * and increase linearly until the maximum bet is reached at the maximum precision.
     *
     * Probability distributions are draw to the supplied canvas object.
     *
     * Various styling options are available through the style object.
     *
     * @param args {{}}
     * @param args.canvas {HTMLElement} - canvas on which to draw the distribution
     * @param [args.xMin = 0] {number} - x axis minimum
     * @param [args.xMax = 100] {number} - x axis maximum
     * @param [args.xPoints = (xMax-xMin)] - number of points on the x axis
     * @param [args.reverseX = false] {boolean} - whether to reverse x axis labels
     * @param [args.minPrecision = .0] {number} - minimum distribution precision (between 0 and 1)
     * @param [args.maxPrecision = 1.0] {number} - maximum distribution precision (between 0 and 1)
     * @param [args.minBet = .0] {number} - minimum bet amount allowed. Assigned to minPrecision.
     * @param [args.maxBet = 1.0] {number} - maximum bet allowed. Assigned to maxPrecision.
     * @param [args.minPayout = -Infinity] {number} - minimum payout on any round.
     * @param [args.maxPayout = Infinity] {number} - maximum payout on any round.
     * @param [args.scaleFactor = 10] {number} - factor by which to scale the curve width
     *
     * @param [args.constantAUC = true] {boolean} - whether to increase inbounds values where parts of
     * the distribution are outside of the limits of the x axis.
     *
     * @param [args.hoverDisplay = false] {boolean} - whether to show the payout display on hover
     *
     * @param [args.style = {}] {{}} - styling options. Default to Distribution.defaultStyle.
     *
     * @param [args.callback = {}] {{}} - callbacks
     * @param [args.callback.onUpdate = null] {function} - called when Distribution updates from cursor click.
     * Called with the click event as a parameter.
     *
     * @param [startEnabled = true] {boolean} - whether to begin with the canvas clickable
     *
     * @return {Distribution}
     */
    constructor(args, startEnabled = true) {
        let canvas = typeof args.canvas === "undefined"? null : args.canvas;
        this.xMin = typeof args.xMin === "undefined"? 0 : args.xMin;
        this.xMax = typeof args.xMax === "undefined"? 100 : args.xMax;
        this.xPoints = typeof args.xPoints === "undefined"? this.xMax - this.xMin : args.xPoints;
        this.reverseX = typeof args.reverseX === "undefined"? false : args.reverseX;
        this.minPrecision = typeof args.minPrecision === "undefined"? .10 : args.minPrecision;
        this.maxPrecision = typeof args.maxPrecision === "undefined"? .9 : args.maxPrecision;
        this.minBet = typeof args.minBet === "undefined"? .10 : args.minBet;
        this.maxBet = typeof args.maxBet === "undefined"? .90 : args.maxBet;
        this.minPayout = typeof args.minPayout === "undefined"? -Infinity : args.minPayout;
        this.maxPayout = typeof args.maxPayout === "undefined"? Infinity : args.maxPayout;
        this.scaleFactor = typeof args.scaleFactor === "undefined"? 10 : args.scaleFactor;

        this.hoverDisplay = typeof args.hoverDisplay === "undefined"? false : args.hoverDisplay;

        this.startEnabled = startEnabled;

        this.callback = Distribution.defaultCallbacks;
        if(typeof args.callback !== "undefined")
            Object.keys(args.callback).forEach((k)=>this.callback[k] = args.callback[k]);

        this.registerCanvas(canvas);

        // cartesian coordinates
        this.x = [];
        let step = (this.xMax - this.xMin) / this.xPoints;
        for(let i = 0; i <= this.xMax - this.xMin; i++)
            this.x[i] = this.xMin + step * i;
        if(this.reverseX) {
            this.x = this.x.reverse();
        }
        this.y = [];

        this.precisionRaw = [];
        this.precision = [];

        // betting coordinates
        this.bet = {
            y: 0, // y coordinate
            precision: 0, // precision of the bet
            amount: this.minBet, // y in bet space
            on: this.xMin + (this.xMax - this.xMin),
            won: 0.0
        };

        this.style = Distribution.defaultStyle;
        if(typeof args.style !== "undefined")
            Object.keys(args.style).forEach((k)=>this.style[k] = args.style[k]);

        this.constantAUC = typeof args.constantAUC === "undefined"? true : args.constantAUC;

        if(this.style.precisionPadding === 'auto') {
            // by default precision padding means the top of the curve is visible when AUC adjusted at extremes
            this.style.precisionPadding = this.maxPossiblePrecision - this.maxPrecision;
        }
        this.style.precisionPadding += this.style.precisionMargin;

        if(this.constantAUC)
            this.adjustedLimits = {
                low: this.adjustForAUC(this.minPrecision),
                high: this.adjustForAUC(this.maxPrecision)
            };
        else
            this.adjustedLimits = {
                low: null,
                high: null
            };

        // timing of key events
        this.time = {
            bet: -1,
            start: new Date().getTime(),
        };

        if(typeof this.callback.onFinishLoading === "function")
            this.callback.onFinishLoading();
        return this;
    }

    /**
     * Default style options.
     */
    static get defaultStyle() {
        return {
            gutterX: 0,
            gutterY: 0,
            paddingX: 0,
            paddingY: 0,

            widgetSize: 5,
            showWidgetLabel: true,

            axisStrokeStyleX: 'black',
            axisLineWidthX: 2,
            axisTicksX: 10,
            axisTickSizeX: 5,
            axisLabelFontX: 'Arial',
            axisLabelFontSizeX: 16,
            axisPositionX: 0,

            axisStrokeStyleY: 'black',
            axisLineWidthY: 2,
            axisTicksY: 10,
            axisTickSizeY: 5,
            axisLabelFontY: 'Arial',
            axisLabelFontSizeY: 16,
            axisPositionY: 0,

            precisionPadding: 'auto',
            precisionMargin: .0, // margin is added to padding and allows extra padding on an auto value for padding
            precisionStart: .0,

            backgroundColor: 'white',

            rectangleFill: 'lightblue',
            rectangleFillLow: 'red',
            rectangleHighlight: 'lightgreen',

            animationFill: 'blue',
            animationStroke: 'lightgreen',
            animationTextShow: true
        };
    }

    /**
     * Default callbacks.
     * * onAnimationEnd(xIndex, yCoordinate, pixelsPerFrame, frameNumber)
     * * onAnimationFrame(xIndex, yCoordinate, pixelsPerFrame, frameNumber)
     * * onUpdate()
     * * onRegisterCanvas(canvas)
     * * onFinishLoading()
     * * onDraw()
     */
    static get defaultCallbacks() {
        return {
            onAnimationEnd: null,
            onAnimationFrame: null,
            onUpdate: null,
            onRegisterCanvas: null,
            onFinishLoading: null,
            onDraw: null
        };
    }

    /**
     * Performs mutual registration between a canvas and the Distribution
     * @param canvas {HTMLCanvasElement} canvas element
     * @return {Distribution} self for chaining
     */
    registerCanvas(canvas) {
        this.canvas = canvas;
        this.canvas.distribution = this;
        this.canvas.drawToCanvas = function(event) {
            this.distribution.drawToCanvas(event);
        };
        this.canvas.updateHoverDisplay = function(event) {
            this.distribution.updateHoverDisplay(event);
        };
        this.canvas.clickMouse = function(clickEvent) {
            this.registerTrackMouse();
            this.drawToCanvas(clickEvent)
        };
        this.canvas.registerTrackMouse = function(enable = true) {
            if(enable)
                this.addEventListener('mousemove', this.drawToCanvas);
            else
                this.removeEventListener('mousemove', this.drawToCanvas);
        };
        this.canvas.registerClickMouse = function(enable = true) {
            if(enable)
                this.addEventListener('mousedown', this.clickMouse);
            else
                this.removeEventListener('mousedown', this.clickMouse);
        };
        this.canvas.registerHoverTrackMouse = function(enable = true) {
            if(enable)
                this.addEventListener('mousemove', this.updateHoverDisplay);
            else
                this.removeEventListener('mousemove', this.updateHoverDisplay);
        };

        this.canvas.addEventListener('mouseup', ()=>this.canvas.registerTrackMouse(false));
        this.canvas.addEventListener('mouseout', ()=>this.canvas.registerTrackMouse(false));

        if(this.startEnabled) {
            this.canvas.registerClickMouse(true);
            this.canvas.registerHoverTrackMouse(this.hoverDisplay);
        }

        if(typeof this.callback.onRegisterCanvas === "function")
            this.callback.onRegisterCanvas(this.canvas);

        return this;
    }

    /**
     * Avoids numerous recalculations of a square root
     * @return {number} - Math.sqrt(2 * Math.PI)
     */
    static get root2pi() {
        return 2.5066282746310002;
    }

    /**
     * Return f(x) which is the frequency of x in the normal distribution
     * @param x {number[]} base score
     * @param mu {number} mean of the normal distribution
     * @param sd {number} standard deviation of the normal distribution
     * @return {number[]} resulting f(x) values
     */
    static f(x, mu, sd) {
        let y = [];
        const z = 1 / (Distribution.root2pi * sd);
        const w = Math.pow(2*sd, 2);
        for(let i = 0; i < x.length; i++) {
            // normal distribution
            y[i] = z * Math.exp(-(Math.pow(x[i] - mu,2) / w));
        }
        return y;
    }

    /**
     * Find the value z for which the sum of values in y is closest to 0
     * @param y {number[]}
     * @return {number}
     */
    static findIntercept(y) {
        // This can probably just be -(mean of the y values)!
        let error = Infinity;
        let newError = Infinity;
        let z = 0;
        let yNew = [];
        for(let i = utils.getMin(y);
            i < utils.getMax(y);
            i += (utils.getMax(y)-utils.getMin(y)) / y.length) {
            yNew = utils.add(y, -i);
            newError = Math.abs(utils.sum(yNew));
            if(newError < error) {
                error = newError;
                z = i;
            }
        }
        return z;
    }

    /**
     * Return the constant area-under-curve adjusted y coordinates
     * @param x {number} mean/modal x value
     * @param xValues {number[]} x values
     * @param yValues {number[]} precision values corresponding to x values
     * @return {number[]} precision values adjusted for AUC
     */
    static adjustForConstantAUC(x, xValues, yValues) {
        let yValuesNew = yValues;
        // Remainder is the absolute difference of tail areas
        let remainder = 0;
        for(let i = 0; i < xValues.length; i++) {
            if(xValues[i] < x)
                remainder += yValues[i];
            else if(xValues[i] > x)
                remainder -= yValues[i];
        }
        remainder = Math.abs(remainder);
        if(remainder/xValues.length > 0) {
            // increase each y value proportionately to its current value
            let sum = utils.sum(yValues);
            for(let i = 0; i < yValues.length; i++) {
                yValuesNew[i] += remainder * (yValues[i] / sum);
            }
        }
        return yValuesNew;
    }

    /**
     * Generate the AUC adjusted peak precision values for the distribution's x values at a specified precision
     * @param precision {number} precision value for which to calculate the adjusted curve
     * @return {number[]} precision values adjusted for constant area-under-curve
     */
    adjustForAUC(precision) {
        let out = [];
        for(let i = 0; i < this.x.length; i++) {
            let y = Distribution.f(this.x, this.x[i], this.getSD(precision));
            out[i] = Distribution.adjustForConstantAUC(this.x[i], this.x, y)[i];
        }
        return out;
    }

    /**
     * Find the maximum number of pixels assignable to each point, and the number of pixels left over
     * @param points {int} number of points required
     * @param pixels {int} number of pixels available
     * @return {{ratio: number, remainder: number}}
     */
    static getPixelRatio(points, pixels) {
        let ratio = Math.floor(pixels / points);
        let remainder = pixels - (ratio * points);
        return {ratio, remainder};
    }

    /**
     * @return {number} Precision value at the extremes of x value and maxPrecision with AUC adjustment
     */
    get maxPossiblePrecision() {
        if(!this.constantAUC)
            return this.maxPrecision;
        let y = Distribution.f(this.x, this.x[this.x.length-1], this.getSD(this.maxPrecision));
        return Distribution.adjustForConstantAUC(this.x[this.x.length-1], this.x, y)[this.x.length-1] * this.scale;
    }

    /**
     * Number of pixels for each cartesian point
     * @return {{x: number, y: number}}
     */
    get pixelsPerPoint() {
        return {
            x: Distribution.getPixelRatio(this.x.length, this.canvas.clientWidth).ratio,
            y: Distribution.getPixelRatio(this.maxPossiblePrecision - this.style.precisionStart,
                this.canvas.clientHeight).ratio // y axis 0:maxPrecision
        };
    }

    get scale() {
        // scale standard deviation and precision to x axis
        return this.x.length / this.scaleFactor;
    }

    /**
     * Return the standard deviation required to peak at a given precision value
     * @param [precision] {number} precision value at which to peak. Defaults to the current bet precision.
     * @return {number} standard deviation of the distribution
     */
    getSD(precision) {
        if(typeof precision ===  "undefined")
            precision = this.bet.precision;

        // sd has to be such that the highest y value should be the mean specified by the user
        // This can be obtained by rearranging the normal distribution formula for x = mode(x)
        return 1 / (Distribution.root2pi * precision / this.scale);
    }

    /**
     * Return cursor position in panel coordinates
     * @param clickEvent {MouseEvent}
     * @param save {boolean} whether to update saved coordaintes
     * @return {{x: number, y: number}}
     */
    getCursorCoordinates(clickEvent, save = true) {
        let x = clickEvent.clientX -
            this.canvas.getBoundingClientRect().left - this.canvas.clientLeft - this.panel.left;
        let y = clickEvent.clientY -
            this.canvas.getBoundingClientRect().top - this.canvas.clientTop - this.panel.top;

        x = x < 0? 0 : x > this.panel.width? this.panel.width : x;
        y = y < 0? 0 : y > this.panel.height? this.panel.height : y;

        // save raw cursor position
        if(save)
            this.cursorPosition = {x, y};

        // reverse y coordinate to handle graphics using reversed y axis
        y = this.panel.height - y;

        return {x, y};
    }

    findPrecisionWhichAdjustsTo(targetPrecision, maxError = 0.00001, maxCycles = 1000) {
        let testPrecision = targetPrecision;
        let cycles = 0;
        let searchDownwards = false;
        let stepSize = .5;
        let best = {input: testPrecision, result: testPrecision, error: Infinity};
        while(cycles++ < maxCycles) {
            let y = Distribution.f(this.x, this.bet.on, this.getSD(testPrecision));
            let result = Distribution.adjustForConstantAUC(this.bet.on, this.x, y)[this.bet.index] * this.scale;
            let error = Math.abs(result - targetPrecision);

            // update best value
            if (best.error > error) {
                // getting warmer...
                best = {input: testPrecision, result, error};
                if(best.error < maxError)
                    break; // good enough, we're done
            } else {
                // colder - do something different
                // reduce step size
                stepSize /= 2;
                // reverse search direction
                searchDownwards = !searchDownwards;
                // go back to our best result
                testPrecision = best.input;
            }

            testPrecision += (searchDownwards? -1 : 1) * stepSize;
        }

        return cycles >= maxCycles? NaN : best.input;
    }

    /**
     * Calculate the mean and precision as a function of the cursor position
     * @return {Distribution} - return self for chaining
     */
    updateFromCursor(clickEvent) {
        let cursor = this.getCursorCoordinates(clickEvent);

        // desired mean is the x equivalent value of the mouse x coordinate clamped by the max
        this.bet.index = this.xToValue(cursor.x);
        this.bet.on = this.x[this.bet.index];

        // y as proportion of space available
        this.bet.precision = this.yToPrecision(cursor.y);

        if(this.constantAUC) {
            this.bet.precision = this.findPrecisionWhichAdjustsTo(this.bet.precision);
        }

        // Clamp by allowed precision range
        this.bet.precision = this.bet.precision < this.minPrecision?
            this.minPrecision : this.bet.precision > this.maxPrecision?
                this.maxPrecision : this.bet.precision;

        this.bet.y = this.precisionToY(this.bet.precision);

        // desired bet amount is proportion of the betting space available
        this.bet.amount = this.yToPayout(this.bet.y);
        this.bet.time = new Date().getTime();

        if(typeof this.callback.onUpdate === "function")
            this.callback.onUpdate(clickEvent);

        return this;
    }

    /**
     * Generate new y values for a given mean and precision
     *
     * @return Distribution - return self for chaining
     */
    updateY() {
        // Calculate the y values
        this.precisionRaw = Distribution.f(this.x, this.bet.on, this.getSD());

        // Adjust y values for cases where the distribution has portions which are out-of-range
        if(this.constantAUC)
            this.precision = Distribution.adjustForConstantAUC(this.bet.on, this.x, this.precisionRaw);
        else
            this.precision = this.precisionRaw;

        // Scale resulting y values to match x axis range
        // let range = this.xMax - this.xMin;
        for(let i = 0; i < this.precision.length; i++)
            this.y[i] = this.precisionToY(this.precision[i] * this.scale);

        return this;
    }

    /**
     * Clear the canvas
     * @return {Distribution} self for chaining
     */
    clearCanvas() {
        let ctx = this.canvas.getContext('2d');
        ctx.clearRect(0,0,this.canvas.clientWidth, this.canvas.clientHeight);
        this.canvas.style.backgroundColor = this.style.backgroundColor;
        return this;
    }

    drawRectangles() {
        let ctx = this.canvas.getContext('2d');
        ctx.lineWidth = this.pixelsPerPoint.x / 4;
        let strokeStyle = {
            low: ctx.lineWidth <= 1? this.style.rectangleFillLow : this.style.backgroundColor,
            high: ctx.lineWidth <= 1? this.style.rectangleFill : this.style.backgroundColor
        };

        for(let i = 0; i < this.y.length; i++) {
            ctx.beginPath();
            ctx.rect(this.valueToX(this.x[i]) - this.pixelsPerPoint.x/4,
                this.panel.bottom - this.y[i],
                this.pixelsPerPoint.x - this.pixelsPerPoint.x/2, // account for the frame in the width
                this.y[i]);
            ctx.strokeStyle = strokeStyle.high;
            ctx.fillStyle = this.style.rectangleFill;
            ctx.fill();
            ctx.stroke();
        }
        return this;
    }

    /**
     * Draw a single rectangle. Used for animations.
     * @param xIndex {int} index of this.x to use for positioning rectangle
     * @param y {number} y-coordinate of the rectangle's extremity from the origin
     * @param [fill=style.animationStroke] {string|null} colour of the rectangle fill
     * @param [line=style.animationFill] {string|null} colour of the rectangle outline
     * @return {Distribution}
     */
    drawRectangle(xIndex, y, fill = null, line = null) {
        let ctx = this.canvas.getContext('2d');
        ctx.beginPath();
        ctx.strokeStyle = line !== null? line : this.style.animationStroke;
        ctx.fillStyle = fill !== null? fill : this.style.animationFill;
        ctx.lineWidth = this.pixelsPerPoint.x / 4;
        ctx.rect(
            this.valueToX(this.x[xIndex]) - this.pixelsPerPoint.x/4,
            this.panel.bottom - y,
            this.pixelsPerPoint.x - this.pixelsPerPoint.x/2,
            y);
        ctx.fill();
        ctx.stroke();
        return this;
    }

    /**
     * Show the rectangle at xIndex collapsing towards 0 on the y axis. Recursive calling through setTimeout
     * @param xIndex {int} index of this.x of rectangle
     * @param [pixelsPerFrame=5] {number} pixels to remove each frame
     * @param [frameNumber=0] {int} which frame is currently playing
     */
    animatePayout(xIndex, pixelsPerFrame = 5, frameNumber = 0) {
        let y = this.y[xIndex];
        let lt0 = y < 0;
        if(lt0)
            y += pixelsPerFrame * frameNumber;
        else
            y -= pixelsPerFrame * frameNumber;
        let end = y < 0 !== lt0; // we swapped sides, we're done
        if(end)
            y = 0;

        this.clearCanvas()
            .drawRectangles()
            .highlightColumn(xIndex)
            .drawRectangle(xIndex, y)
            .drawAxisX()
            .drawWidget({
                x: this.valueToX(this.x[this.bet.index]),
                y: this.y[this.bet.index]
            });

        if(typeof this.callback.onDraw === "function")
            this.callback.onDraw();
        if(typeof this.callback.onAnimationFrame === "function")
            this.callback.onAnimationFrame(xIndex, y, pixelsPerFrame, frameNumber);

        if(!end)
            this.animationTimeout = setTimeout(()=>this.animatePayout(xIndex, pixelsPerFrame, frameNumber+1), 20);
        else
            if(typeof this.callback.onAnimationEnd === "function")
                this.callback.onAnimationEnd(xIndex, y, pixelsPerFrame, frameNumber);
    }

    highlightColumn(xIndex) {
        let ctx = this.canvas.getContext('2d');
        ctx.beginPath();
        ctx.lineWidth = this.pixelsPerPoint.x / 4;
        ctx.strokeStyle = 'lightgreen';
        ctx.fillStyle = 'lightgreen';
        ctx.rect(
            this.valueToX(this.x[xIndex]) - this.pixelsPerPoint.x/2,
            0,
            this.pixelsPerPoint.x,
            this.canvas.clientHeight
        );
        ctx.fill();
        ctx.stroke();
        return this;
    }

    /**
     * Draw the moving widget
     * @param centre {{x: number, y: number}} coordinates for the widget's centre
     */
    drawWidget(centre) {
        let ctx = this.canvas.getContext('2d');

        ctx.beginPath();
        ctx.fillStyle = 'white';
        ctx.strokeStyle = 'black';
        ctx.arc(centre.x, this.panel.bottom - centre.y, this.style.widgetSize, 0, 2 * Math.PI);
        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();

        if(this.style.showWidgetLabel)
            this.labelWidget(centre);

        return this;
    }

    labelWidget(widgetPosition) {
        let bet = this.yToPayout(this.y[this.bet.index]);
        let betString = (Math.round(bet*100)/100).toFixed(2);

        let label = {
            text: "$" + betString + " on " + (this.bet.on).toString(),
            font: '14px Arial',
            left: widgetPosition.x + this.style.widgetSize*2,
            width: 100,
            top: widgetPosition.y + this.style.widgetSize,
            height: 10
        };

        if(label.left + label.width > this.panel.width)
            label.left -= label.width;

        if(label.top < label.height * 2)
            label.top = label.height * 2;
        if(label.top > this.panel.bottom - label.height)
            label.top = this.panel.bottom - label.height;

        let ctx = this.canvas.getContext('2d');
        ctx.textAlign = 'left';
        ctx.font = label.font;
        ctx.strokeText(label.text, label.left, this.panel.bottom - label.top);

        return this;
    }

    drawToCanvas(clickEvent) {
        if(clickEvent === null)
            return console.log('No click event sent to drawToCanvas');
        if(this.canvas === null) // TODO: better check for canvas usability. Move to constructor?
            return console.log('No canvas defined for drawToCanvas');

        this.updateFromCursor(clickEvent)
            .updateY();

        this.clearCanvas()
            .drawRectangles()
            .drawAxisX();

        this.drawWidget({
            x: this.valueToX(this.x[this.bet.index]),
            y: this.y[this.bet.index]
        });

        if(typeof this.callback.onDraw === "function")
            this.callback.onDraw();

        return this;
    }

    /**
     * Draw the result by redrawing the display and overlaying a highlighted column.
     * @param result
     * @return {Distribution}
     */
    showResult(result) {
        // Save amount won
        let x = this.x.indexOf(result);
        this.bet.won = this.yToPayout(this.y[x]);
        this.animatePayout(x);

        return this;
    }

    /**
     * The gutter runs along the edges of the canvas and is adjusted to ensure the content is centred on the canvas.
     * @return {{x: number, y: number}}
     */
    get gutter() {
        let graphGap = this.canvas.clientWidth - (this.pixelsPerPoint.x * (this.xMax - this.xMin));
        return {
            x: this.style.gutterX + graphGap/2,
            y: this.style.gutterY
        }
    }

    /**
     * Panel is the bit the graph is drawn on: canvas minus gutter and padding
     * @return {{left: *, right: *, top: *, bottom: *, height: *, width: *}}
     */
    get panel() {
        let out = {
            left: this.gutter.x + this.style.paddingX,
            top: this.gutter.y + this.style.paddingY
        };
        out.width = this.canvas.clientWidth - out.left*2;
        out.height = this.canvas.clientHeight - out.top*2;
        out.bottom = out.top + out.height; // saves a lot of repetition
        out.right = out.left + out.width;
        return out;
    }

    /**
     * Return the x coordinate of a given value from the x-scale
     * @param value {number|number[]} value on the x-axis to plot
     * @return {number} x coordinate for plotting
     */
    valueToX(value) {
        if(typeof value === "undefined")
            return NaN;
        if(typeof value.length !== "undefined") {
            let sum = 0;
            for(let i = 0; i < value.length; i++)
                sum += this.valueToX(value[i]);
            return sum;
        }
        return this.panel.left + this.panel.width / this.x.length * (value - this.xMin) + this.pixelsPerPoint.x/2;
    }

    /**
     * Return the value on the x scale of coordinate 'x'
     * @param x {number|number[]} coordinate
     * @return {number} value
     */
    xToValue(x) {
        if(typeof x === "undefined")
            return NaN;
        if(typeof x.length !== "undefined") {
            let sum = 0;
            for(let i = 0; i < x.length; i++)
                sum += this.xToValue(x[i]);
            return sum;
        }
        return Math.min(Math.floor(x / this.panel.width * this.x.length), this.x.length-1);
    }

    /**
     * Scaling factor to map precision ratings to pixels.
     * Precision to pixels = precision * precisionScale
     * Pixels to precision = pixels / precisionScale
     */
    get precisionScale() {
        let precisionRange = this.maxPrecision + this.style.precisionPadding;
        let pixelRange = this.panel.height;
        return pixelRange/precisionRange;
    }

    precisionToY(precision) {
        if(typeof precision === "undefined")
            return NaN;
        if(typeof precision.length !== "undefined") {
            let sum = 0;
            for(let i = 0; i < precision.length; i++)
                sum += this.precisionToY(precision[i]);
            return sum;
        }
        return (precision - this.style.precisionStart) * this.precisionScale;
    }

    yToPrecision(y) {
        if(typeof y === "undefined")
            return NaN;
        if(typeof y.length !== "undefined") {
            let sum = 0;
            for(let i = 0; i < y.length; i++)
                sum += this.yToPrecision(y[i]);
            return sum;
        }
        return y / this.precisionScale + this.style.precisionStart;
    }

    /**
     * Scale payout values to pixels
     * @return {number}
     */
    get payoutScale() {
        let betRange = this.maxBet - this.minBet;
        let precisionRange = this.maxPrecision - this.minPrecision;
        let betAsPrecision = precisionRange / betRange;
        return betAsPrecision * this.precisionScale;
    }

    /**
     * Return a payout or bet value as a y coordinate
     * @param payout {number|number[]} payout to plot
     * @return {number} y-coordinate for plotting
     */
    payoutToY(payout) {
        if(typeof payout === "undefined")
            return NaN;
        if(typeof payout.length !== "undefined") {
            let sum = 0;
            for(let i = 0; i < payout.length; i++)
                sum += this.payoutToY(payout[i]);
            return sum;
        }
        return (this.minPrecision - this.style.precisionStart) * this.precisionScale +
            (payout - this.minBet) * this.payoutScale;
    }

    /**
     * Return a y coordinate as a payout value
     * @param y {number|number[]} y-coordinate
     * @param capByPayoutLimits {boolean} whether to allow values above maxPayout or below minPayout
     * @return {number} payout value
     */
    yToPayout(y, capByPayoutLimits = true) {
        if(typeof y === "undefined")
            return NaN;
        if(typeof y.length !== "undefined") {
            let sum = 0;
            for(let i = 0; i < y.length; i++)
                sum += this.yToPayout(y[i], capByPayoutLimits);
            return sum;
        }
        let out = this.minBet +
            (y - (this.minPrecision - this.style.precisionStart) * this.precisionScale) / this.payoutScale;
        if(!capByPayoutLimits)
            return out;
        return out < this.minPayout? this.minPayout : out > this.maxPayout? this.maxPayout : out;
    }

    /**
     * Draw the value axis
     * @param [y] {number} y coordinate at which to draw the axis
     * @return {Distribution} self for chaining
     */
    drawAxisX(y) {
        let ctx = this.canvas.getContext('2d');
        // line
        y = typeof y === "undefined"? this.panel.bottom + this.style.axisPositionX : y;
        ctx.strokeStyle = this.style.axisStrokeStyleX;
        ctx.lineWidth = this.style.axisLineWidthX;
        ctx.beginPath();
        ctx.moveTo(this.panel.left, y);
        ctx.lineTo(this.panel.left + this.panel.width, y);
        ctx.strokeStyle = this.style.axisStrokeStyleX;
        ctx.stroke();
        // ticks
        ctx.font = this.style.axisLabelFontSizeX.toString() + 'px' + ' ' + this.style.axisLabelFontX;
        ctx.textAlign = 'center';
        for(let i = 0; i <= this.style.axisTicksX; i++) {
            let x = Math.round(this.xMin + (this.xMax - this.xMin) / this.style.axisTicksX * i);
            let xPosition = this.valueToX(x);
            ctx.moveTo(xPosition, y);
            ctx.lineTo(xPosition, y + this.style.axisTickSizeX);
            ctx.stroke();
            ctx.strokeText(x.toString(), xPosition, y + this.style.axisTickSizeX*2.5);
        }
        return this;
    }

    /**
     * Draw the payout axis
     * @param [x] {number} x coordinate at which to draw the axis
     * @return {Distribution} self for chaining
     */
    drawAxisY(x) {
        // payouts are defined by clamping minBet to minPrecision and maxBet to maxPrecision
        x = typeof x === "undefined"? this.panel.left + this.style.axisPositionY : x;
        let ctx = this.canvas.getContext('2d');
        ctx.strokeStyle = this.style.axisStrokeStyleY;
        ctx.lineWidth = this.style.axisLineWidthY;
        ctx.beginPath();
        ctx.moveTo(x, this.panel.height + this.panel.top);
        ctx.lineTo(x, this.panel.top);
        ctx.stroke();
        // ticks
        let tickDistance = this.panel.height / 10;
        ctx.font = this.style.axisLabelFontSizeY.toString() + 'px' + ' ' + this.style.axisLabelFontY;
        let label = "";
        for(let i = 0; i <= 10; i++) {
            ctx.moveTo(x, this.panel.height + this.panel.top - tickDistance*i);
            ctx.lineTo(x - this.style.axisTickSizeY, this.panel.height + this.panel.top - tickDistance*i);
            ctx.stroke();
            label = this.yToPayout(i*this.panel.height/10).toFixed(2);
            ctx.strokeText(
                label,
                x - this.style.axisTickSizeY*2,
                this.panel.height + this.panel.top - tickDistance*i + this.style.axisLabelFontSizeY/4);
        }
        return this;
    }

    createHoverDisplay() {
        let id = 'DistributionHoverDisplay';
        let hd = document.getElementById(id);
        if(hd !== null) {
            this.hoverDisplayElement = hd;
            return this;
        }
        hd = document.createElement('div');
        hd.id = id;
        hd.style.position = 'fixed';
        this.canvas.parentElement.appendChild(hd);
        this.hoverDisplayElement = hd;
        return this;
    }

    updateHoverDisplay(mouseEvent) {
        if(!this.hoverDisplay)
            return;
        if(typeof this.hoverDisplayElement === "undefined")
            this.createHoverDisplay();
        if(typeof this.y === "undefined")
            return;

        let cursor = this.getCursorCoordinates(mouseEvent, false);
        let value = this.xMin + this.xToValue(cursor.x);
        let payout = this.yToPayout(this.y[this.x.indexOf(value)]);
        let html = 'Payout for ' + value.toString() + ' = ' + payout.toFixed(2);
        html += '; AUC = ' + utils.sum(this.y).toFixed(2) + 'y; $' + this.yToPayout(this.y).toFixed(2);
        this.hoverDisplayElement.innerHTML = html;
    }

    /**
     * Draw guide axes to illustrate the different customisation properties.
     * Draws the following:
     * * Gutters (black fill)
     * * Padding (green fill)
     * * x axis showing % of pixel space (black)
     * * y axis showing x values (black)
     * * min/maxPrecision boundaries (pink)
     * * AUC-adjusted precision boundaries (orange, if applicable)
     * * precision scale from style.precisionStart to maxPrecision+style.precisionPadding (red)
     * * payout scale (black, central)
     * * betting scale over allowed betting space (blue)
     */
    showGuides() {
        let ctx = this.canvas.getContext('2d');

        // Gutters
        // adjust for centering the display
        ctx.beginPath();
        ctx.fillStyle = 'black';
        ctx.fillRect(0,0,this.gutter.x,this.canvas.clientHeight);
        ctx.fillRect(0,0,this.canvas.clientWidth,this.gutter.y);
        ctx.fillRect(0,this.canvas.clientHeight-this.gutter.y,this.canvas.clientWidth,this.gutter.y);
        ctx.fillRect(this.canvas.clientWidth-this.gutter.x,0,this.gutter.x,this.canvas.clientHeight);

        // Padding
        let paddingLeft = this.gutter.x;
        let paddingTop = this.gutter.y;
        let paddingWidth = this.canvas.clientWidth - this.gutter.x*2;
        let paddingHeight = this.canvas.clientHeight - this.gutter.y*2;
        ctx.fillStyle = 'lightgreen';
        ctx.fillRect(paddingLeft, paddingTop, this.style.paddingX, paddingHeight);
        ctx.fillRect(paddingLeft, paddingTop, paddingWidth, this.style.paddingY);
        ctx.fillRect(
            paddingLeft,
            this.canvas.clientHeight - this.gutter.y - this.style.paddingY,
            paddingWidth,
            this.style.paddingY);
        ctx.fillRect(
            this.canvas.clientWidth - this.gutter.x - this.style.paddingX,
            paddingTop,
            this.style.paddingX,
            paddingHeight);

        // Precision limits
        ctx.strokeStyle = 'pink';
        ctx.moveTo(
            this.panel.left,
            this.panel.bottom - (this.maxPrecision - this.style.precisionStart) * this.precisionScale);
        ctx.lineTo(
            this.panel.left + this.panel.width,
            this.panel.bottom - (this.maxPrecision - this.style.precisionStart) * this.precisionScale);
        ctx.stroke();
        ctx.moveTo(
            this.panel.left,
            this.panel.bottom - (this.minPrecision - this.style.precisionStart) * this.precisionScale);
        ctx.lineTo(
            this.panel.left + this.panel.width,
            this.panel.bottom - (this.minPrecision - this.style.precisionStart) * this.precisionScale);
        ctx.stroke();

        // AUC-adjusted precision limits
        if(this.constantAUC) {
            let limits = [];
            ctx.strokeStyle = 'orange';
            for(let j = 0; j < 2; j++) {
                limits = j > 0? this.adjustedLimits.high : this.adjustedLimits.low;
                ctx.beginPath();
                ctx.moveTo(this.valueToX(this.x[0]), this.panel.bottom - this.precisionToY(limits[0] * this.scale));
                for(let i = 0; i < this.x.length; i++) {
                    ctx.lineTo(this.valueToX(this.x[i]), this.panel.bottom - this.precisionToY(limits[i] * this.scale));
                }
                ctx.stroke();
            }

            limits = this.adjustedLimits.high;
            ctx.beginPath();
            ctx.moveTo(this.valueToX(this.x[0]), this.panel.bottom - this.precisionToY(limits[0] * this.scale));
            for(let i = 0; i < this.x.length; i++) {
                ctx.lineTo(this.valueToX(this.x[i]), this.panel.bottom - this.precisionToY(limits[i] * this.scale));
            }
            ctx.stroke();
        }

        // X Axis
        this.drawAxisX();

        // Y Axes

        // 1. Y space
        // line
        let yAxisX = this.panel.left + this.style.axisPositionY;
        ctx.strokeStyle = this.style.axisStrokeStyleY;
        ctx.lineWidth = this.style.axisLineWidthY;
        ctx.beginPath();
        ctx.moveTo(yAxisX, this.panel.bottom);
        ctx.lineTo(yAxisX, this.panel.top);
        ctx.stroke();

        // tics
        let tickDistance = this.panel.height / this.style.axisTicksY;
        ctx.font = this.style.axisLabelFontY + ' ' + this.style.axisLabelFontSizeY.toString() + 'px';
        ctx.textAlign = 'right';
        let label = "";
        for(let i = 0; i <= this.style.axisTicksY; i++) {
            ctx.moveTo(yAxisX, this.panel.bottom - tickDistance*i);
            ctx.lineTo(yAxisX - this.style.axisTickSizeY, this.panel.bottom - tickDistance*i);
            ctx.stroke();
            label = Math.round(100/this.style.axisTicksY*i).toFixed(1);
            ctx.strokeText(
                label,
                yAxisX - this.style.axisTickSizeY*2,
                this.panel.height + this.panel.top - tickDistance*i + this.style.axisLabelFontSizeY/4);
        }

        // 2. Precision space
        // draw another y axis indented a bit which shows the precision space
        let precisionX = this.panel.left + this.panel.width * .25;
        ctx.strokeStyle = 'red';
        ctx.beginPath();
        ctx.moveTo(precisionX, this.panel.bottom);
        ctx.lineTo(
            precisionX,
            this.panel.bottom - (this.maxPrecision - this.style.precisionStart)*this.precisionScale);
        ctx.stroke();
        // ticks
        tickDistance = (this.maxPrecision - this.style.precisionStart) / 10 * this.precisionScale;
        label = "";
        for(let i = 0; i <= 10; i++) {
            ctx.moveTo(precisionX, this.panel.bottom - tickDistance*i);
            ctx.lineTo(precisionX - this.style.axisTickSizeY, this.panel.bottom - tickDistance*i);
            ctx.stroke();
            label = (this.style.precisionStart + i*(this.maxPrecision - this.style.precisionStart)/10).toFixed(2);
            ctx.strokeText(
                label,
                precisionX - this.style.axisTickSizeY*2,
                this.panel.height + this.panel.top - tickDistance*i + this.style.axisLabelFontSizeY/4);
        }

        // 3. Payout space
        this.drawAxisY(this.panel.left + this.panel.width * .5);

        // 4. Betting space
        // betting space is defined by the minBet for minPrecision and maxBet for maxPrecision
        let betX = this.panel.left + this.panel.width * .75;
        let betY = this.panel.bottom - this.payoutToY(this.minBet);
        ctx.strokeStyle = 'blue';
        ctx.beginPath();
        ctx.moveTo(betX, betY);
        ctx.lineTo(betX, this.panel.bottom - this.payoutToY(this.maxBet));
        ctx.stroke();
        // ticks
        tickDistance = (this.maxBet - this.minBet) * this.payoutScale / 10;
        label = "";
        for(let i = 0; i <= 10; i++) {
            ctx.moveTo(betX, betY - tickDistance*i);
            ctx.lineTo(betX - this.style.axisTickSizeY, betY - tickDistance*i);
            ctx.stroke();
            label = (this.minBet + i*(this.maxBet - this.minBet)/10).toFixed(2);
            ctx.strokeText(
                label,
                betX - this.style.axisTickSizeY*2,
                betY - tickDistance*i + this.style.axisLabelFontSizeY/4);
        }

        return this;
    }
}

class utils {
    /**
     * Find the minimum value in arr[]
     * @param arr {number[]}
     * @return {number}
     */
    static getMin(arr) {
        return(arr.reduce((a,b)=>Math.min(a,b)));
    }

    /**
     * Find the maximum value in arr[]
     * @param arr {number[]}
     * @return {number}
     */
    static getMax(arr) {
        return(arr.reduce((a,b)=>Math.max(a,b)));
    }

    /**
     * Add val to each element of arr
     * @param arr {number[]}
     * @param val {number}
     * @return {number[]}
     */
    static add(arr, val) {
        let newArr = [];
        for(let i = 0; i < arr.length; i++)
            newArr[i] = arr[i] + val;
        return newArr;
    }

    /**
     * Return the sum of elements in arr
     * @param arr {number[]}
     * @return {number}
     */
    static sum(arr) {
        let total = 0;
        for(let i = 0; i < arr.length; i++)
            total += arr[i];
        return total;
    }
}

export {Distribution};