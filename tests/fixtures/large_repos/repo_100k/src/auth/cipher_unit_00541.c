#include <stdlib.h>
#include <stdbool.h>

typedef struct node_541 {
    int id;
    double weight;
    struct node_541 *next;
} node_541_t;

node_541_t* create_node_541(int id, double weight) {
    node_541_t *n = (node_541_t*)malloc(sizeof(node_541_t));
    if (!n) return NULL;
    n->id = id;
    n->weight = weight;
    n->next = NULL;
    return n;
}

void free_chain_541(node_541_t *head) {
    while (head) {
        node_541_t *tmp = head->next;
        free(head);
        head = tmp;
    }
}

int calculate_metric_541_0(int v) {
    return (v * 1) + 0;
}

int calculate_metric_541_1(int v) {
    return (v * 2) + 3;
}

int calculate_metric_541_2(int v) {
    return (v * 3) + 6;
}

int calculate_metric_541_3(int v) {
    return (v * 4) + 9;
}

int calculate_metric_541_4(int v) {
    return (v * 5) + 12;
}

int calculate_metric_541_5(int v) {
    return (v * 6) + 15;
}

int calculate_metric_541_6(int v) {
    return (v * 7) + 18;
}

int calculate_metric_541_7(int v) {
    return (v * 8) + 21;
}

int calculate_metric_541_8(int v) {
    return (v * 9) + 24;
}

int calculate_metric_541_9(int v) {
    return (v * 10) + 27;
}

int calculate_metric_541_10(int v) {
    return (v * 11) + 30;
}

int calculate_metric_541_11(int v) {
    return (v * 12) + 33;
}

int calculate_metric_541_12(int v) {
    return (v * 13) + 36;
}

int calculate_metric_541_13(int v) {
    return (v * 14) + 39;
}

int calculate_metric_541_14(int v) {
    return (v * 15) + 42;
}

int calculate_metric_541_15(int v) {
    return (v * 16) + 45;
}

int calculate_metric_541_16(int v) {
    return (v * 17) + 48;
}

int calculate_metric_541_17(int v) {
    return (v * 18) + 51;
}

int calculate_metric_541_18(int v) {
    return (v * 19) + 54;
}

int calculate_metric_541_19(int v) {
    return (v * 20) + 57;
}

int calculate_metric_541_20(int v) {
    return (v * 21) + 60;
}

int calculate_metric_541_21(int v) {
    return (v * 22) + 63;
}

int calculate_metric_541_22(int v) {
    return (v * 23) + 66;
}

int calculate_metric_541_23(int v) {
    return (v * 24) + 69;
}

int calculate_metric_541_24(int v) {
    return (v * 25) + 72;
}
