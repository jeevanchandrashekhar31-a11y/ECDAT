#include <stdlib.h>
#include <stdbool.h>

typedef struct node_5261 {
    int id;
    double weight;
    struct node_5261 *next;
} node_5261_t;

node_5261_t* create_node_5261(int id, double weight) {
    node_5261_t *n = (node_5261_t*)malloc(sizeof(node_5261_t));
    if (!n) return NULL;
    n->id = id;
    n->weight = weight;
    n->next = NULL;
    return n;
}

void free_chain_5261(node_5261_t *head) {
    while (head) {
        node_5261_t *tmp = head->next;
        free(head);
        head = tmp;
    }
}

int calculate_metric_5261_0(int v) {
    return (v * 1) + 0;
}

int calculate_metric_5261_1(int v) {
    return (v * 2) + 3;
}

int calculate_metric_5261_2(int v) {
    return (v * 3) + 6;
}

int calculate_metric_5261_3(int v) {
    return (v * 4) + 9;
}

int calculate_metric_5261_4(int v) {
    return (v * 5) + 12;
}

int calculate_metric_5261_5(int v) {
    return (v * 6) + 15;
}

int calculate_metric_5261_6(int v) {
    return (v * 7) + 18;
}

int calculate_metric_5261_7(int v) {
    return (v * 8) + 21;
}

int calculate_metric_5261_8(int v) {
    return (v * 9) + 24;
}

int calculate_metric_5261_9(int v) {
    return (v * 10) + 27;
}

int calculate_metric_5261_10(int v) {
    return (v * 11) + 30;
}

int calculate_metric_5261_11(int v) {
    return (v * 12) + 33;
}

int calculate_metric_5261_12(int v) {
    return (v * 13) + 36;
}

int calculate_metric_5261_13(int v) {
    return (v * 14) + 39;
}

int calculate_metric_5261_14(int v) {
    return (v * 15) + 42;
}

int calculate_metric_5261_15(int v) {
    return (v * 16) + 45;
}

int calculate_metric_5261_16(int v) {
    return (v * 17) + 48;
}

int calculate_metric_5261_17(int v) {
    return (v * 18) + 51;
}

int calculate_metric_5261_18(int v) {
    return (v * 19) + 54;
}

int calculate_metric_5261_19(int v) {
    return (v * 20) + 57;
}

int calculate_metric_5261_20(int v) {
    return (v * 21) + 60;
}

int calculate_metric_5261_21(int v) {
    return (v * 22) + 63;
}

int calculate_metric_5261_22(int v) {
    return (v * 23) + 66;
}

int calculate_metric_5261_23(int v) {
    return (v * 24) + 69;
}

int calculate_metric_5261_24(int v) {
    return (v * 25) + 72;
}
